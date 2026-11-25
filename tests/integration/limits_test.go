//go:build integration

package integration

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/crmf/crmf/internal/server/app"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/migrate"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestEffectiveLimitsAuthenticatedIsolation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	adminURL := "postgres://crmf_migrator:crmf_local_migrator_only@localhost:55432/crmf_control?sslmode=disable"
	if err := migrate.Up(ctx, adminURL, "control"); err != nil { t.Fatal(err) }
	admin, err := pgx.Connect(ctx, adminURL); if err != nil { t.Fatal(err) }
	t.Cleanup(func(){ _=admin.Close(context.Background()) })
	core, err := pgx.Connect(ctx, "postgres://crmf_core:crmf_local_core_only@localhost:55432/crmf_control?sslmode=disable")
	if err != nil {t.Fatal(err)}
	t.Cleanup(func(){_=core.Close(context.Background())})
	identity,err:=auth.Open(ctx,"postgres://crmf_auth:crmf_local_auth_only@localhost:55432/crmf_control?sslmode=disable")
	if err!=nil {t.Fatal(err)}
	t.Cleanup(identity.Close)

	user,staff,tenant,other,plan,otherPlan:=uuid.New(),uuid.New(),uuid.New(),uuid.New(),uuid.New(),uuid.New()
	t.Cleanup(func(){
		c, stop:=context.WithTimeout(context.Background(),10*time.Second);defer stop()
		for _,u:=range []uuid.UUID{user,staff} {
			if _,err:=admin.Exec(c,"DELETE FROM auth.users WHERE id=$1",u);err!=nil {t.Error("cleanup identity",err)}
		}
		for _,id:=range []uuid.UUID{tenant,other} {
			if _,err:=admin.Exec(c,"DELETE FROM core.subscriptions WHERE tenant_id=$1",id);err!=nil {t.Error(err)}
			if _,err:=admin.Exec(c,"DELETE FROM core.tenants WHERE id=$1",id);err!=nil {t.Error(err)}
		}
		for _,id:=range []uuid.UUID{plan,otherPlan} {
			if _,err:=admin.Exec(c,"DELETE FROM core.plans WHERE id=$1",id);err!=nil {t.Error(err)}
		}
	})
	exec:=func(sql string,args ...any) {t.Helper();if _,err:=admin.Exec(ctx,sql,args...);err!=nil {t.Fatal(err)}}
	for i,pair:=range [][2]uuid.UUID{{tenant,plan},{other,otherPlan}} {
		id,p:=pair[0],pair[1];slug:="limits_"+strings.ReplaceAll(id.String(),"-","")
		exec("INSERT INTO core.tenants(id,slug,legal_name,cnpj,status,schema_name,db_role) VALUES($1,$2,'Synthetic limits tenant',$3,'active',$4,$5)",id,slug,"synthetic-"+id.String(),"t_"+slug,"r_"+slug)
		exec("INSERT INTO core.plans(id,code,name,price_cents,sync_interval_seconds,max_stores,max_users,history_months,modules) VALUES($1,$2,'Synthetic limits plan',100,180,$3,20,12,ARRAY['core','realtime'])",p,"synthetic-"+p.String(),3+i*96)
		exec("INSERT INTO core.subscriptions(id,tenant_id,plan_id,status) VALUES($1,$2,$3,'active')",uuid.New(),id,p)
	}
	for _,id:=range []uuid.UUID{user,staff} {
		exec("INSERT INTO auth.users(id,email,name,status) VALUES($1,$2,'Synthetic limits user','active')",id,id.String()+"@example.invalid")
	}
	exec("INSERT INTO auth.user_grants(id,user_id,role,tenant_id) VALUES($1,$2,'network_admin',$3)",uuid.New(),user,tenant)
	exec("INSERT INTO auth.user_grants(id,user_id,role) VALUES($1,$2,'platform_support')",uuid.New(),staff)
	exec("UPDATE auth.users SET mfa_secret_enc=decode(repeat('11',64),'hex'),mfa_enabled_at=now() WHERE id=$1",staff)
	principal:=func(id uuid.UUID,realm auth.Realm) context.Context {
		t.Helper()
		raw:=make([]byte,32);if _,err:=rand.Read(raw);err!=nil {t.Fatal(err)}
		digest:=sha256.Sum256(raw);now:=time.Now().UTC()
		exec("INSERT INTO auth.user_sessions(id,user_id,token_hash,realm,mfa_verified,last_seen_at,idle_expires_at,expires_at,created_at) VALUES($1,$2,$3,$4,true,$5,$6,$7,$5)",
			uuid.New(),id,digest[:],string(realm),now,now.Add(15*time.Minute),now.Add(time.Hour))
		authenticated,err:=identity.Authenticate(ctx,base64.RawURLEncoding.EncodeToString(raw),realm)
		if err!=nil {t.Fatal(err)}
		return authenticated
	}
	tenantCtx:=principal(user,auth.Tenant)
	limits,err:=app.EffectiveLimits(tenantCtx,core);if err!=nil {t.Fatal(err)}
	if value,finite:=limits.MaxStores();value!=3||!finite {t.Fatal("selected another tenant's limits")}
	if err:=limits.RequireModule("realtime");err!=nil {t.Fatal(err)}
	if _,err:=app.EffectiveLimits(ctx,core);!errors.Is(err,auth.ErrForbidden) {t.Fatal("anonymous access",err)}
	if _,err:=app.EffectiveLimits(principal(staff,auth.Platform),core);!errors.Is(err,auth.ErrForbidden) {t.Fatal("platform tenant lookup",err)}
	if _,err:=app.EffectiveLimits(tenantCtx,nil);!errors.Is(err,app.ErrPlanUnavailable) {t.Fatal("missing connection",err)}

	exec(`UPDATE core.subscriptions SET overrides='{"max_stores":null,"max_users":5,"modules":["export"]}' WHERE tenant_id=$1`,tenant)
	limits,err=app.EffectiveLimits(tenantCtx,core);if err!=nil {t.Fatal(err)}
	if _,finite:=limits.MaxStores();finite {t.Fatal("null is not unlimited")}
	if value,finite:=limits.MaxUsers();value!=5||!finite {t.Fatal("user override")}
	if !errors.Is(limits.RequireModule("realtime"),app.ErrModuleNotInPlan)||limits.RequireModule("export")!=nil {t.Fatal("modules were merged instead of replaced")}
	for _,status:=range []string{"trialing","past_due","active"} {
		exec("UPDATE core.subscriptions SET status=$2 WHERE tenant_id=$1",tenant,status)
		if _,err:=app.EffectiveLimits(tenantCtx,core);err!=nil {t.Fatalf("%s denied: %v",status,err)}
	}
	exec("UPDATE core.plans SET active=false WHERE id=$1",plan)
	if _,err:=app.EffectiveLimits(tenantCtx,core);err!=nil {t.Fatal("retired plan broke existing subscriber")}
	for _,status:=range []string{"suspended","cancelled"} {
		exec("UPDATE core.subscriptions SET status=$2,grace_until=CURRENT_DATE+30 WHERE tenant_id=$1",tenant,status)
		if _,err:=app.EffectiveLimits(tenantCtx,core);!errors.Is(err,auth.ErrSuspended) {t.Fatalf("%s allowed: %v",status,err)}
	}
	exec("UPDATE core.subscriptions SET status='active' WHERE tenant_id=$1",tenant)
	for _,status:=range []string{"suspended","cancelled"} {
		exec("UPDATE core.tenants SET status=$2 WHERE id=$1",tenant,status)
		if _,err:=app.EffectiveLimits(tenantCtx,core);!errors.Is(err,auth.ErrSuspended) {t.Fatal("stale principal bypassed tenant status",err)}
	}
	exec("UPDATE core.tenants SET status='active' WHERE id=$1",tenant)
	exec(`UPDATE core.subscriptions SET overrides='{"max_users":0}' WHERE tenant_id=$1`,tenant)
	if _,err:=app.EffectiveLimits(tenantCtx,core);!errors.Is(err,app.ErrInvalidPlan) {t.Fatal("invalid override allowed",err)}
	exec("DELETE FROM core.subscriptions WHERE tenant_id=$1",tenant)
	if _,err:=app.EffectiveLimits(tenantCtx,core);!errors.Is(err,auth.ErrSuspended) {t.Fatal("missing subscription allowed",err)}
	cancelled,stop:=context.WithCancel(tenantCtx);stop()
	if _,err:=app.EffectiveLimits(cancelled,core);!errors.Is(err,context.Canceled) {t.Fatal("canceled lookup",err)}
}

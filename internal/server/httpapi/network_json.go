package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
)

// Network documents have no nullable members. Check every object for duplicates,
// exact profile fields and nested nulls before decoding the generated DTO.
func decodeNetworkJSON(w http.ResponseWriter, r *http.Request, out any, keys []string, optionalProfile bool) bool {
	var raw json.RawMessage
	if !decodeAuthJSON(w, r, &raw) {
		return false
	}
	valid := func() bool {
		d := json.NewDecoder(bytes.NewReader(raw))
		if !networkJSONValue(d, 0) {
			return false
		}
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil || fields == nil {
			return false
		}
		count := len(keys)
		if _, ok := fields["profile"]; optionalProfile && ok {
			count++
		}
		if len(fields) != count {
			return false
		}
		for _, k := range keys {
			if _, ok := fields[k]; !ok {
				return false
			}
		}
		for _, key := range []string{"data", "profile"} {
			if value, ok := fields[key]; ok {
				var profile map[string]json.RawMessage
				if json.Unmarshal(value, &profile) != nil || len(profile) != 8 {
					return false
				}
				for _, name := range []string{"display_name", "registered_name", "city", "uf", "contact_name", "contact_email", "default_timezone", "billing_customer_id"} {
					if _, ok := profile[name]; !ok {
						return false
					}
				}
			}
		}
		strict := json.NewDecoder(bytes.NewReader(raw))
		strict.DisallowUnknownFields()
		return strict.Decode(out) == nil
	}
	if !valid() {
		problem(w, 400, "invalid_network", "Revise os dados da rede")
		return false
	}
	return true
}
func networkJSONValue(d *json.Decoder, depth int) bool {
	if depth > 8 {
		return false
	}
	t, e := d.Token()
	if e != nil || t == nil {
		return false
	}
	if delim, ok := t.(json.Delim); ok {
		if delim != '{' {
			return false
		}
		seen := map[string]bool{}
		for d.More() {
			key, e := d.Token()
			s, ok := key.(string)
			if e != nil || !ok || seen[s] {
				return false
			}
			seen[s] = true
			if !networkJSONValue(d, depth+1) {
				return false
			}
		}
		end, e := d.Token()
		return e == nil && end == json.Delim('}')
	}
	return true
}

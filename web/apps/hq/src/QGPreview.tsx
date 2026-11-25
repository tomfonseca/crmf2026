import { useState } from "react";
import { useAuthTheme } from "@crmf/auth";
import { Shell } from "./Shell";
import { OperationalScreen } from "./OperationalScreens";
import { qgPreviewCases } from "./qg-preview-cases";
const families: Record<string, string> = {
  "QG-Painel": "overview",
  "QG-Planos": "plans",
  "QG-Planos-Mobile": "plans",
  "QG-Plano-Form": "planForm",
  "QG-Plano-Conflito": "planConflict",
  "QG-Plano-Excluir": "planDelete",
  "QG-Redes": "networks",
  "QG-Rede-Nova": "networkForm",
  "QG-Rede-Preparacao": "setup",
  "QG-Rede": "network",
  "QG-Rede-Acao": "networkAction",
  "QG-Lojas": "stores",
  "QG-Loja-Form": "storeForm",
  "QG-Loja": "store",
  "QG-Loja-Pareamento": "pairing",
  "QG-Loja-Reinstalar": "reinstall",
  "QG-Dispositivos": "devices",
  "QG-Dispositivo": "device",
  "QG-Envios": "batches",
  "QG-Lote": "batch",
};
export function QGPreview() {
  const [file, setFile] = useState<string>("QG-Painel.html"),
    [theme, toggleTheme] = useAuthTheme();
  const entry = qgPreviewCases.find((c) => c.file === file)!;
  const [base, raw = ""] = file.replace(/\.html$/, "").split("--"),
    variant = raw.replace(/^(estado|acao)-/, "");
  const effective = file.includes("tema-escuro") ? "dark" : theme;
  return (
    <div className="dashboard auth-app" data-theme={effective}>
      <div className="qg-preview-controls">
        <strong>
          Prévia visual do QG — dados sintéticos, sem autenticação nem operações
          reais.
        </strong>
        <label>
          Prancheta
          <select value={file} onChange={(e) => setFile(e.target.value)}>
            {qgPreviewCases.map((c) => (
              <option key={c.file}>{c.file}</option>
            ))}
          </select>
        </label>
        <span>125 variações · não usa API nem fornece acesso autenticado.</span>
      </div>
      <Shell
        path="/overview"
        navigate={() => {}}
        theme={effective}
        toggleTheme={toggleTheme}
        support={raw === "papel-suporte"}
      >
        <OperationalScreen
          key={file}
          family={families[base]}
          variant={variant}
          preview
          support={raw === "papel-suporte"}
          title={entry.title}
          navigate={() => {}}
        />
      </Shell>
    </div>
  );
}

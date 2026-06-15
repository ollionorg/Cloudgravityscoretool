import { useState, useRef, useCallback } from "react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import ollionLogo from "../../imports/image.png";
import dimensionDiagram from "../../imports/Screenshot_2026-06-09_at_4.12.55_PM.png";

type Weights = { businessValue: number; cloudReadiness: number; complexity: number; dependencies: number };

const DEFAULT_WEIGHTS: Weights = { businessValue: 0.35, cloudReadiness: 0.35, complexity: 0.20, dependencies: 0.10 };

const DIMENSIONS: { key: keyof Weights; label: string; description: string; icon: string }[] = [
  { key: "businessValue",  label: "Business Value",  icon: "📈", description: "Measures impact on revenue generation, customer experience enhancements, and overarching business agility." },
  { key: "cloudReadiness", label: "Cloud Readiness", icon: "☁️", description: "Evaluates technical compatibility, focusing on modern architecture, containerisation, and microservices readiness." },
  { key: "complexity",     label: "Complexity",      icon: "⚙️", description: "Assesses existing technical debt, reliance on specialised hardware, and specific regulatory constraints." },
  { key: "dependencies",   label: "Dependencies",    icon: "🔗", description: "Identifies tightly coupled legacy systems and strict latency requirements to core banking infrastructure." },
];

const READINESS_BANDS = [
  { band: "Highly Applicable",        short: "Highly Applicable",  color: "#01777A", bg: "#d0e8e8", score: "≥ 3.5",      strategy: "Replatform / Refactor", platform: "AWS / GCP",   action: "Modernise core services; leverage cloud-native services for maximum agility and scalability." },
  { band: "Conditionally Applicable", short: "Conditional",        color: "#C1911B", bg: "#faecd0", score: "2.5–3.49",   strategy: "Rehost / Repurchase",   platform: "Azure",        action: "Lift-and-shift or replace with SaaS to reduce technical debt." },
  { band: "Not Applicable for Cloud", short: "Not Applicable",     color: "#EC4632", bg: "#fcdbd8", score: "< 2.5",      strategy: "Retain / Retire",       platform: "On-Premise",   action: "Keep tightly regulated systems on-premise, or decommission redundant applications." },
];

const WORKLOAD_CATEGORIES = [
  "Customer-facing digital", "Core banking & payments", "Analytics & AI/ML", "Disaster recovery",
  "Dev / Test / Staging", "Regulated PII & sensitive data", "Digital and mobile banking / containerised microservices",
  "Data, analytics, and AI workloads", "Identity and legal/compliance workflows",
  "External-facing non-critical services", "Core banking / payment systems / hardware-tethered / regulatory-mandated",
] as const;

interface ImportRowBase {
  name: string; owner: string; tier: string; workloadCategory: string; description: string;
  scores: { businessValue: number; cloudReadiness: number; complexity: number; dependencies: number };
  valid: boolean; errors: string[];
}

interface HomePageProps {
  onLaunch: (weights: Weights, importRows: ImportRowBase[] | null, importFileName: string | null) => void;
}

function clampScore(v: unknown): number {
  const n = Number(v);
  if (isNaN(n)) return 0;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function HomePage({ onLaunch }: HomePageProps) {
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [dragOver, setDragOver] = useState(false);
  const [importRows, setImportRows] = useState<ImportRowBase[] | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const weightTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  const weightsValid = Math.abs(weightTotal - 1) < 0.001;

  const setWeight = (dim: keyof Weights, pct: number) =>
    setWeights(w => ({ ...w, [dim]: Math.round(pct) / 100 }));

  const parseFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const XLSX = await import("xlsx");
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const parsed: ImportRowBase[] = rows.map(row => {
        const errors: string[] = [];
        const name = String(row["Application Name"] ?? row["Name"] ?? row["App Name"] ?? "").trim();
        if (!name) errors.push("Missing application name");
        const bv = clampScore(row["Business Value"] ?? row["BV"] ?? row["BusinessValue"]);
        const cr = clampScore(row["Cloud Readiness"] ?? row["CR"] ?? row["CloudReadiness"]);
        const cx = clampScore(row["Complexity"] ?? row["CX"] ?? row["Cx"]);
        const dp = clampScore(row["Dependencies"] ?? row["DP"] ?? row["Dep"]);
        if (!bv) errors.push("Invalid Business Value (1–5)");
        if (!cr) errors.push("Invalid Cloud Readiness (1–5)");
        if (!cx) errors.push("Invalid Complexity (1–5)");
        if (!dp) errors.push("Invalid Dependencies (1–5)");
        const rawCategory = String(row["Workload Category"] ?? row["WorkloadCategory"] ?? row["Category"] ?? "").trim();
        const workloadCategory = (WORKLOAD_CATEGORIES as readonly string[]).includes(rawCategory) ? rawCategory : WORKLOAD_CATEGORIES[0];
        return {
          name, owner: String(row["Owner"] ?? row["Division"] ?? "").trim(),
          tier: String(row["Tier"] ?? row["Application Tier"] ?? "Business").trim() || "Business",
          workloadCategory, description: String(row["Description"] ?? "").trim(),
          scores: { businessValue: bv || 3, cloudReadiness: cr || 3, complexity: cx || 3, dependencies: dp || 3 },
          valid: errors.length === 0, errors,
        };
      });
      setImportRows(parsed);
      setImportFileName(file.name);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", overflow: "auto", minWidth: 900, background: "var(--background)", fontFamily: "Inter, sans-serif" }}>

      {/* ── Header ── */}
      <header style={{ flexShrink: 0, height: 52, background: "var(--primary)", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <ImageWithFallback src={ollionLogo} alt="Ollion" style={{ height: 22, width: "auto", objectFit: "contain", filter: "brightness(0) invert(1)" }} />
          <span style={{ width: 1, height: 14, background: "rgba(255,255,255,0.15)" }} />
          <span style={{ fontWeight: 600, fontSize: 14, color: "var(--primary-foreground)" }}>Workload Placement Framework</span>
        </div>
        <span style={{ fontSize: 11, color: "rgba(242,237,235,0.3)", fontFamily: "JetBrains Mono, monospace" }}>2026</span>
      </header>

      {/* ── Body: two columns ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden", minWidth: 900 }}>

        {/* ── LEFT PANEL: description + classification table + dimension cards ── */}
        <div style={{ flex: 1, minWidth: 520, overflowY: "auto", padding: "32px 28px 32px 32px", display: "flex", flexDirection: "column", gap: 28, borderRight: "1px solid var(--border)" }}>

          {/* Hero text */}
          <div>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--accent)", fontWeight: 700, marginBottom: 10 }}>Workload Placement Tool</p>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
              <h1 style={{ fontSize: 38, fontWeight: 700, color: "var(--foreground)", lineHeight: 1.1, letterSpacing: "-0.01em", fontFamily: "Newsreader, Georgia, serif", margin: 0 }}>Workload Placement<br />Framework</h1>
              <ImageWithFallback src={dimensionDiagram} alt="Four scoring dimensions: Business Value, Cloud Readiness, Complexity, Dependencies" style={{ height: 110, width: "auto", objectFit: "contain" }} />
            </div>
            <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.7, maxWidth: 520 }}>
              Ollion's Workload Placement Framework determines workload placement across AWS, GCP, Azure, and On-Premise based on a weighted readiness model. Each application is evaluated across four dimensions to produce a Gravity Score (1.0–5.0) that drives migration strategy and 6R pattern selection.
            </p>
          </div>

          {/* Readiness classification table */}
          <div style={{ background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "var(--secondary)" }}>
              <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, color: "var(--muted-foreground)" }}>Readiness Classification</p>
            </div>
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
              <thead>
                <tr style={{ background: "var(--primary)" }}>
                  {["Readiness Band", "Score", "6R Strategy", "Action Profile"].map(h => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, color: "var(--primary-foreground)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {READINESS_BANDS.map((b, i) => (
                  <tr key={b.band} style={{ borderBottom: i < READINESS_BANDS.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: b.bg, color: b.color, whiteSpace: "nowrap" }}>{b.short}</span>
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 11, fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: b.color, whiteSpace: "nowrap" }}>{b.score}</td>
                    <td style={{ padding: "11px 14px", fontSize: 12, color: "var(--foreground)", fontWeight: 600, whiteSpace: "nowrap" }}>{b.strategy}</td>
                    <td style={{ padding: "11px 14px", fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.4 }}>{b.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {/* 6R Decision Logic */}
          <div style={{ background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, color: "var(--muted-foreground)" }}>6R Strategy — How It's Calculated</p>
              <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>Weighted score drives strategy · raw scores act as qualifiers</span>
            </div>
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr style={{ background: "var(--primary)" }}>
                  {["Weighted Score", "Raw Score Qualifier", "→ 6R Strategy", "Rationale"].map(h => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, color: "var(--primary-foreground)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { score: "< 2.0",   qualifier: "Any",          pattern: "Retire",      color: "#EC4632", bg: "#fcdbd8", rationale: "Critically low gravity — no viable cloud case." },
                  { score: "Any",     qualifier: "BV ≥ 4 & CR ≤ 2", pattern: "Retain", color: "#3B4430", bg: "#e8ede0", rationale: "High value but insufficient readiness — stay on-prem." },
                  { score: "≥ 2.5",   qualifier: "BV ≤ 2",       pattern: "Repurchase",  color: "#2F3A4C", bg: "#dce3ed", rationale: "Low differentiation — SaaS replacement more economical." },
                  { score: "< 2.5",   qualifier: "Any",          pattern: "Rehost",      color: "#C1911B", bg: "#faecd0", rationale: "Below threshold — lift-and-shift while readiness matures." },
                  { score: "≥ 4.0",   qualifier: "CX ≤ 3",       pattern: "Refactor",    color: "#01777A", bg: "#d0e8e8", rationale: "Strong gravity + low complexity → cloud-native re-architecture." },
                  { score: "≥ 3.0",   qualifier: "Any",          pattern: "Replatform",  color: "#01777A", bg: "#d0e8e8", rationale: "Solid gravity — move to managed PaaS without full rebuild." },
                  { score: "Default", qualifier: "—",             pattern: "Rehost",      color: "#C1911B", bg: "#faecd0", rationale: "Conditional band — migrate conservatively, re-evaluate later." },
                ].map((row, i, arr) => (
                  <tr key={row.pattern + i} style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none", background: i % 2 === 0 ? "var(--card)" : "var(--secondary)" }}>
                    <td style={{ padding: "10px 14px", fontFamily: "JetBrains Mono, monospace", fontSize: 12, fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>{row.score}</td>
                    <td style={{ padding: "10px 14px", fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{row.qualifier}</td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: row.bg, color: row.color }}>{row.pattern}</span>
                    </td>
                    <td className="font-[Instrument_Sans]" style={{ padding: "10px 14px", fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.4 }}>{row.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {/* Dimension cards */}
          <div>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted-foreground)", fontWeight: 700, marginBottom: 14 }}>Scoring Dimensions</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {DIMENSIONS.map(d => (
                <div key={d.key} style={{ background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", padding: "18px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 20 }}>{d.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: "var(--foreground)" }}>{d.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "rgba(1,119,122,0.1)", color: "var(--accent)", fontFamily: "JetBrains Mono, monospace" }}>
                      {Math.round(weights[d.key] * 100)}%
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.55 }}>{d.description}</p>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ── RIGHT PANEL: weights + import + launch ── */}
        <div style={{ width: 380, flexShrink: 0, overflowY: "auto", padding: "32px 32px 32px 28px", display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Weights explainer */}
          <div style={{ padding: "14px 16px", borderRadius: 10, background: "rgba(1,119,122,0.06)", border: "1px solid rgba(1,119,122,0.2)" }}>
            <p style={{ fontSize: 12, color: "var(--foreground)", lineHeight: 1.6 }}>
              <strong style={{ color: "var(--accent)" }}>How weights affect your results:</strong> Each dimension's weight determines its contribution to the final Gravity Score (1.0–5.0). A higher weight on <em>Business Value</em> will favour applications with strong strategic impact, while heavier <em>Cloud Readiness</em> weighting prioritises technical compatibility. The resulting score directly drives the <strong>6R migration strategy</strong> and target platform recommendation for every application.
            </p>
          </div>

          {/* Dimension Weights */}
          <div style={{ background: "var(--card)", borderRadius: 14, border: "1px solid var(--border)", padding: "22px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 14, color: "var(--foreground)", marginBottom: 2 }}>Dimension Weights</p>
                <p style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Must total 100% to launch</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontSize: 12, padding: "3px 10px", borderRadius: 999, fontFamily: "JetBrains Mono, monospace", fontWeight: 700,
                  background: weightsValid ? "rgba(1,119,122,0.12)" : "rgba(236,70,50,0.12)",
                  color: weightsValid ? "var(--accent)" : "var(--destructive)",
                }}>
                  {Math.round(weightTotal * 100)}%
                </span>
                <button onClick={() => setWeights(DEFAULT_WEIGHTS)}
                  style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--muted-foreground)", cursor: "pointer", fontWeight: 600 }}>
                  Reset
                </button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {DIMENSIONS.map(d => {
                const pct = Math.round(weights[d.key] * 100);
                return (
                  <div key={d.key}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)", display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{d.icon}</span>{d.label}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <input type="number" min={0} max={100} value={pct}
                          onChange={e => setWeight(d.key, Number(e.target.value))}
                          style={{ width: 44, padding: "3px 6px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--input-background)", color: "var(--foreground)", fontSize: 12, fontFamily: "JetBrains Mono, monospace", fontWeight: 700, textAlign: "right", outline: "none" }} />
                        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>%</span>
                      </div>
                    </div>
                    <div style={{ position: "relative", height: 6, borderRadius: 999, background: "var(--muted)" }}>
                      <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 999, width: `${pct}%`, background: "var(--accent)", transition: "width 0.2s" }} />
                      <input type="range" min={0} max={100} step={1} value={pct}
                        onChange={e => setWeight(d.key, Number(e.target.value))}
                        style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", margin: 0, height: "100%" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bulk Import */}
          <div style={{ background: "var(--card)", borderRadius: 14, border: "1px solid var(--border)", padding: "22px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 14, color: "var(--foreground)", marginBottom: 2 }}>Bulk Import</p>
              <p style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Upload .xlsx, .xls, or .csv — one app per row</p>
            </div>

            {!importFileName ? (
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f); }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  borderRadius: 10, border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
                  background: dragOver ? "rgba(1,119,122,0.04)" : "var(--secondary)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 10, padding: "28px 16px", cursor: "pointer", transition: "all 0.2s",
                }}>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--card)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, border: "1px solid var(--border)" }}>⊕</div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontWeight: 600, fontSize: 13, color: "var(--foreground)", marginBottom: 2 }}>Drop file or click to browse</p>
                  <p style={{ fontSize: 11, color: "var(--muted-foreground)" }}>.xlsx · .xls · .csv</p>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 8, background: "var(--secondary)", border: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 20 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: 12, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{importFileName}</p>
                    <p style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                      {importRows?.length} rows ·{" "}
                      <span style={{ color: "#01777A", fontWeight: 600 }}>{importRows?.filter(r => r.valid).length} valid</span>
                      {(importRows?.filter(r => !r.valid).length ?? 0) > 0 && (
                        <span style={{ color: "#EC4632", fontWeight: 600 }}> · {importRows?.filter(r => !r.valid).length} errors</span>
                      )}
                    </p>
                  </div>
                  <button onClick={() => { setImportRows(null); setImportFileName(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", flexShrink: 0 }}>
                    Clear
                  </button>
                </div>
                <div style={{ borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden", maxHeight: 160, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead style={{ position: "sticky", top: 0 }}>
                      <tr style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
                        {["", "Application", "Owner", "BV", "CR", "CX", "DP"].map(h => (
                          <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importRows?.map((row, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "var(--card)" : "var(--secondary)", opacity: row.valid ? 1 : 0.6 }}>
                          <td style={{ padding: "5px 8px", textAlign: "center" }}>
                            <span style={{ color: row.valid ? "#01777A" : "#EC4632" }}>{row.valid ? "✓" : "✗"}</span>
                          </td>
                          <td style={{ padding: "5px 8px", fontWeight: 600, color: "var(--foreground)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</td>
                          <td style={{ padding: "5px 8px", color: "var(--muted-foreground)" }}>{row.owner || "—"}</td>
                          {[row.scores.businessValue, row.scores.cloudReadiness, row.scores.complexity, row.scores.dependencies].map((s, si) => (
                            <td key={si} style={{ padding: "5px 8px", textAlign: "center", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: "var(--accent)" }}>{s}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Launch */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              onClick={() => onLaunch(weights, importRows, importFileName)}
              disabled={!weightsValid}
              style={{
                padding: "14px 24px", borderRadius: 10, border: "none",
                background: weightsValid ? "var(--accent)" : "var(--muted)",
                color: weightsValid ? "#fff" : "var(--muted-foreground)",
                fontSize: 15, fontWeight: 700, cursor: weightsValid ? "pointer" : "not-allowed",
                transition: "all 0.2s", width: "100%",
                boxShadow: weightsValid ? "0 4px 16px rgba(1,119,122,0.25)" : "none",
              }}>
              {importRows && importRows.filter(r => r.valid).length > 0
                ? `Launch & Import ${importRows.filter(r => r.valid).length} Apps →`
                : "Launch Scoring Tool →"}
            </button>
            {!weightsValid && (
              <p style={{ fontSize: 11, color: "var(--destructive)", textAlign: "center" }}>Weights must sum to 100% before launching.</p>
            )}
            {weightsValid && !importFileName && (
              <p style={{ fontSize: 11, color: "var(--muted-foreground)", textAlign: "center" }}>You can also import applications from the tool's Bulk Import tab.</p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

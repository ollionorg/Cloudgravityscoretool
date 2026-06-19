import { useState, useCallback, useEffect, useRef } from "react";

function lsLoad<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : fallback; } catch { return fallback; }
}
function lsSave(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* quota */ }
}
import { ImageWithFallback } from "./figma/ImageWithFallback";
import ollionLogo from "../../imports/image.png";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DimensionScore {
  businessValue: number;
  cloudReadiness: number;
  complexity: number;
  dependencies: number;
}

interface ApplicationInput {
  name: string;
  description: string;
  owner: string;
  tier: string;
  workloadCategory: string;
  currentPlatform: string;
  scores: DimensionScore;
}

interface GravityResult {
  totalScore: number;
  band: "Highly Applicable" | "Conditionally Applicable" | "Not Applicable for Cloud";
  recommendation6R: string;
  targetPlatform: string;
  platformRationale: string;

  rationale: string;
  dimensionBreakdown: { dimension: string; raw: number; weighted: number; weight: number }[];
}

type Tab = "score" | "result" | "portfolio" | "import";

interface ImportRow {
  name: string; owner: string; tier: string; workloadCategory: string; currentPlatform: string; description: string;
  scores: DimensionScore; valid: boolean; errors: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

type Weights = { businessValue: number; cloudReadiness: number; complexity: number; dependencies: number };
const DEFAULT_WEIGHTS: Weights = { businessValue: 0.35, cloudReadiness: 0.35, complexity: 0.20, dependencies: 0.10 };

const SCORE_CRITERIA: Record<keyof DimensionScore, { label: string; short: string; description: string; levels: string[] }> = {
  businessValue: {
    label: "Business Value", short: "BV",
    description: "Strategic and financial value of migrating this application to cloud",
    levels: [
      "Minimal — legacy system with no active users",
      "Low — limited strategic importance",
      "Moderate — operationally relevant",
      "High — business-critical with growth potential",
      "Transformational — enables new digital capabilities",
    ],
  },
  cloudReadiness: {
    label: "Cloud Readiness", short: "CR",
    description: "Technical readiness of the application for cloud deployment",
    levels: [
      "Not ready — tightly coupled to on-prem hardware",
      "Low — significant re-architecture needed",
      "Moderate — containerisable with medium effort",
      "High — stateless or already containerised",
      "Cloud-native — 12-factor, API-first architecture",
    ],
  },
  complexity: {
    label: "Complexity", short: "CX",
    description: "Migration complexity — higher score means simpler migration",
    levels: [
      "Extremely complex — custom hardware dependencies",
      "High — many integrations, proprietary middleware",
      "Moderate — standard enterprise patterns",
      "Low — mostly stateless with few integrations",
      "Minimal — standalone, well-documented",
    ],
  },
  dependencies: {
    label: "Dependencies", short: "DP",
    description: "Dependency footprint — higher score means cleaner separation",
    levels: [
      "Heavy — shared databases, HSM or PCI scope",
      "Significant — multiple upstream/downstream systems",
      "Moderate — manageable interface contracts",
      "Few — 1–2 well-defined APIs",
      "Independent — self-contained, no shared state",
    ],
  },
};

const WORKLOAD_CATEGORIES = [
  "Customer-facing digital",
  "Core banking & payments",
  "Analytics & AI/ML",
  "Disaster recovery",
  "Dev / Test / Staging",
  "Regulated PII & sensitive data",
  "Digital and mobile banking / containerised microservices",
  "Data, analytics, and AI workloads",
  "Identity and legal/compliance workflows",
  "External-facing non-critical services",
  "Core banking / payment systems / hardware-tethered / regulatory-mandated",
] as const;

const PLATFORM_BY_CATEGORY: Record<string, string> = {
  "Customer-facing digital":                                              "AWS (Public Cloud)",
  "Core banking & payments":                                              "On-Premise (Primary DC)",
  "Analytics & AI/ML":                                                    "GCP + On-Premise (Hybrid)",
  "Disaster recovery":                                                    "DRC (On-Premise) + AWS Standby",
  "Dev / Test / Staging":                                                 "AWS (Ephemeral)",
  "Regulated PII & sensitive data":                                       "On-Premise only",
  "Digital and mobile banking / containerised microservices":             "AWS",
  "Data, analytics, and AI workloads":                                    "GCP",
  "Identity and legal/compliance workflows":                              "Azure",
  "External-facing non-critical services":                                "Alibaba Cloud",
  "Core banking / payment systems / hardware-tethered / regulatory-mandated": "On-Premise (Primary DC)",
};

const PLATFORM_RATIONALE_BY_CATEGORY: Record<string, string> = {
  "Customer-facing digital":                                              "High-traffic, user-facing workloads benefit from AWS's global CDN, elastic scaling, and managed services to meet availability and performance SLAs.",
  "Core banking & payments":                                              "Transaction-critical systems with strict latency and regulatory requirements are kept in the primary data centre to maintain full operational control.",
  "Analytics & AI/ML":                                                    "Data-intensive pipelines leverage GCP's BigQuery and Vertex AI for scale-out processing, while sensitive source data remains on-premise under governance controls.",
  "Disaster recovery":                                                    "The on-premise DRC provides the primary failover site; AWS Standby adds a cloud-based recovery tier for extended outages or site-level failures.",
  "Dev / Test / Staging":                                                 "Non-production environments are provisioned ephemerally on AWS to reduce cost, accelerate developer iteration, and avoid contention with production workloads.",
  "Regulated PII & sensitive data":                                       "PII and sensitive data must remain on-premise to satisfy data-residency and privacy regulations — no cloud option is permitted for this category.",
  "Digital and mobile banking / containerised microservices":             "Digital and mobile banking channels and containerised microservices (e.g. OCTO Mobile, OCTO Biz, OCTO@Work) target AWS for 3-AZ active-active high availability, ROSA container platform, and proven digital experience reference architecture.",
  "Data, analytics, and AI workloads":                                    "Data, analytics, and AI workloads (e.g. EDP-01, OCTO AI, SIGMA, Digital Loan) target GCP for BigQuery integration, native ML/AI services, and cost-effective scale-out analytical processing.",
  "Identity and legal/compliance workflows":                              "Identity and legal/compliance workloads (e.g. Keycloak, LADIES) target Azure for Active Directory integration, compliance tooling, and enterprise identity federation.",
  "External-facing non-critical services":                                "External-facing non-critical services target Alibaba Cloud as a cost-effective platform for non-mission-critical external integrations.",
  "Core banking / payment systems / hardware-tethered / regulatory-mandated": "Hardware dependencies, real-time payment rails, and mandatory regulatory controls prevent cloud hosting; these systems remain in the primary data centre indefinitely.",
};

const SAME_PLATFORM_PROVIDERS = ["AWS", "GCP", "Azure", "Alibaba Cloud"];

// Maps any common variation of a cloud provider name to a canonical label
const detectCloudProvider = (platform: string): string | null => {
  if (!platform) return null;
  const p = platform.toLowerCase().trim();
  if (p.includes("aws") || p.includes("amazon")) return "AWS";
  if (p.includes("gcp") || p.includes("google cloud") || p.includes("google")) return "GCP";
  if (p.includes("azure") || p.includes("microsoft azure") || p.includes("microsoft")) return "Azure";
  if (p.includes("alibaba") || p.includes("aliyun")) return "Alibaba Cloud";
  return null;
};

const PLATFORM_LOGIC = (workloadCategory: string, t: number, currentPlatform: string) => {
  if (t < 2.5) return "On-Premise (Retain)";
  const alreadyOn = detectCloudProvider(currentPlatform);
  // If already on cloud with high gravity, show the actual hosting location from the source data
  if (alreadyOn && t > 4.0) return currentPlatform.trim() || alreadyOn;
  const recommended = PLATFORM_BY_CATEGORY[workloadCategory] ?? "On-Premise → Staged";
  if (alreadyOn && !recommended.includes(alreadyOn)) return `${alreadyOn} (Current)`;
  return recommended;
};

const PLATFORM_RATIONALE = (workloadCategory: string, t: number, currentPlatform: string): string => {
  if (t < 2.5) return "Gravity score is below the cloud-viability threshold (2.5). The workload does not demonstrate sufficient business value, cloud readiness, or manageable complexity to justify migration at this time. It is retained on-premise pending re-assessment.";
  const recommended = PLATFORM_BY_CATEGORY[workloadCategory];
  const alreadyOn = detectCloudProvider(currentPlatform);
  if (alreadyOn && recommended && !recommended.includes(alreadyOn)) {
    return `The workload category "${workloadCategory}" would ordinarily point to ${recommended}, but this application is already hosted on ${alreadyOn}. Migrating to a different cloud provider introduces unnecessary complexity and cost — retaining ${alreadyOn} as the target platform is the pragmatic recommendation. Re-evaluate only if a strategic multi-cloud mandate applies.`;
  }
  return PLATFORM_RATIONALE_BY_CATEGORY[workloadCategory] ?? "Platform placement is determined by workload characteristics; a staged migration to the most suitable cloud or hybrid environment is recommended.";
};



const RECOMMEND_6R = (s: DimensionScore, t: number, currentPlatform: string = ""): { pattern: string; rationale: string } => {
  const { businessValue: bv, cloudReadiness: cr, complexity: cx, dependencies: dp } = s;
  const alreadyOnCloud = detectCloudProvider(currentPlatform);

  // Retain on current cloud — already cloud-hosted with exceptional gravity; no migration needed
  if (alreadyOnCloud && t > 4.0)
    return { pattern: "Retain", rationale: `Application is already hosted on ${alreadyOnCloud} and has an exceptional gravity score of ${t.toFixed(2)}. No migration is required — retain on the current cloud platform and focus investment on optimisation and feature delivery rather than re-migration.` };

  // Retire — very low weighted gravity regardless of raw scores
  if (t < 2.0)
    return { pattern: "Retire", rationale: "Weighted gravity score is critically low — application has negligible strategic or technical case for cloud. Decommission." };

  // Retain — high business value but cloud readiness is insufficient
  if (bv >= 4 && cr <= 2)
    return { pattern: "Retain", rationale: "High business value but insufficient cloud readiness — retain on-premise and schedule re-architecture before migration." };

  // Retain — high complexity with heavy dependencies makes migration too risky
  if (cx <= 2 && dp <= 2 && t < 3.0)
    return { pattern: "Retain", rationale: "High migration complexity and heavy dependencies create excessive risk — retain on-premise until dependencies are decoupled." };

  // Repurchase — low business value; SaaS is more economical
  if (bv <= 2 && t >= 2.5 && t < 3.5)
    return { pattern: "Repurchase", rationale: "Low strategic differentiation — a SaaS equivalent delivers better cloud economics than a custom migration." };

  // Rehost — low gravity score; lift-and-shift is safest
  if (t >= 2.0 && t < 2.5)
    return { pattern: "Rehost", rationale: "Gravity score below cloud-ready threshold — lift-and-shift to IaaS preserves value while readiness matures." };

  // Refactor — excellent gravity score with high cloud readiness
  if (t >= 4.0 && cr >= 4)
    return { pattern: "Refactor", rationale: "Exceptional weighted gravity and high cloud readiness — re-architect for cloud-native patterns (microservices, Kubernetes, serverless)." };

  // Refactor — high gravity with low complexity and good dependency separation
  if (t >= 3.5 && cx >= 4 && dp >= 4)
    return { pattern: "Refactor", rationale: "Strong gravity with low complexity and clean dependencies — ideal candidate for cloud-native refactoring to maximize agility." };

  // Replatform — good gravity with moderate cloud readiness
  if (t >= 3.0 && t < 4.0 && cr >= 3)
    return { pattern: "Replatform", rationale: "Good weighted gravity with moderate cloud readiness — move to managed PaaS (RDS, EKS, Cloud SQL) without full re-architecture. Optimise over 12–24 months." };

  // Replatform — high gravity but high complexity prevents full refactor
  if (t >= 4.0 && cx <= 3)
    return { pattern: "Replatform", rationale: "Strong gravity but migration complexity is high — adopt managed services incrementally rather than full refactor. De-risk through phased approach." };

  // Rehost — conditional band with moderate readiness
  if (t >= 2.5 && t < 3.0 && cr >= 3)
    return { pattern: "Rehost", rationale: "Conditional gravity with moderate cloud readiness — lift-and-shift to IaaS first, then re-evaluate for replatform once cloud operations mature." };

  // Rehost — fallback for conditional band
  return { pattern: "Rehost", rationale: "Conditional gravity — start with lift-and-shift to IaaS to gain cloud experience, then optimize incrementally based on performance data." };
};

const EXPLAIN_6R = (s: DimensionScore, t: number, recommended: string, currentPlatform: string = ""): Record<string, { selected: boolean; reason: string }> => {
  const alreadyOnCloud = detectCloudProvider(currentPlatform);
  const cloudProvider = alreadyOnCloud ?? "";
  const { businessValue: bv, cloudReadiness: cr, complexity: cx, dependencies: dp } = s;
  return {
    Retire: {
      selected: recommended === "Retire",
      reason: recommended === "Retire"
        ? `Gravity score of ${t.toFixed(2)} is critically low (threshold: < 2.0), indicating negligible strategic and technical case for cloud migration. Decommissioning is the most cost-effective outcome.`
        : t >= 2.0
          ? `Not selected: gravity score of ${t.toFixed(2)} is above the retirement threshold (2.0), meaning the application retains sufficient business or technical value to justify a migration path.`
          : `Not selected despite low score: another pattern better fits the combination of dimension scores.`,
    },
    Retain: {
      selected: recommended === "Retain",
      reason: recommended === "Retain"
        ? alreadyOnCloud && t > 4.0
          ? `Already hosted on ${cloudProvider} with an exceptional gravity score (${t.toFixed(2)}). No migration needed — retain on the current cloud platform and redirect investment toward optimisation and feature delivery.`
          : bv >= 4 && cr <= 2
            ? `Not selected for cloud: business value is high (${bv}/5) but cloud readiness is low (${cr}/5). Migrating now would introduce unacceptable risk — retain on-premise and invest in readiness before re-assessing.`
            : `High migration complexity (${cx}/5) and heavy dependencies (${dp}/5) create excessive risk at this gravity score (${t.toFixed(2)}). Retain on-premise until dependencies are decoupled.`
        : alreadyOnCloud && t > 4.0
          ? `Would normally be selected: application is on ${cloudProvider} with score ${t.toFixed(2)} > 4.0, but another rule took priority.`
          : `Not selected: the application does not meet the Retain criteria. A cloud migration path is viable at this profile.`,
    },
    Rehost: {
      selected: recommended === "Rehost",
      reason: recommended === "Rehost"
        ? t < 2.5
          ? `Gravity score of ${t.toFixed(2)} falls in the conditional band (2.0–2.49). A lift-and-shift to IaaS is the safest first move — it preserves value without requiring architectural changes while cloud readiness matures.`
          : `Conditional gravity (${t.toFixed(2)}) with moderate cloud readiness (${cr}/5) — lift-and-shift to IaaS first, then re-evaluate for replatform once cloud operations are established.`
        : t >= 3.0
          ? `Not selected: gravity score of ${t.toFixed(2)} is strong enough to justify optimisation beyond a basic lift-and-shift. A higher pattern (Replatform or Refactor) delivers more long-term value.`
          : `Not selected: the application's dimension profile points to a more targeted pattern than a generic lift-and-shift.`,
    },
    Replatform: {
      selected: recommended === "Replatform",
      reason: recommended === "Replatform"
        ? cx <= 3 && t >= 4.0
          ? `Strong gravity (${t.toFixed(2)}) but migration complexity is elevated (${cx}/5). A full refactor carries too much risk — adopting managed PaaS services incrementally de-risks the migration through a phased approach.`
          : `Good gravity (${t.toFixed(2)}) with moderate cloud readiness (${cr}/5). Moving to managed PaaS (e.g. RDS, EKS, Cloud SQL) delivers meaningful cloud benefit without requiring a full re-architecture. Optimise over 12–24 months.`
        : t >= 4.0 && cr >= 4
          ? `Not selected: exceptional gravity (${t.toFixed(2)}) and high cloud readiness (${cr}/5) mean the application can fully absorb the investment of a cloud-native Refactor, which delivers greater long-term agility.`
          : t < 3.0
            ? `Not selected: gravity score of ${t.toFixed(2)} is below the Replatform threshold (3.0). The application should be Rehosted first to establish a cloud baseline before optimising.`
            : `Not selected: the combination of dimension scores points to a different pattern as the best fit.`,
    },
    Refactor: {
      selected: recommended === "Refactor",
      reason: recommended === "Refactor"
        ? t >= 4.0 && cr >= 4
          ? `Exceptional gravity (${t.toFixed(2)}) and high cloud readiness (${cr}/5) make this application an ideal candidate for full cloud-native re-architecture — microservices, Kubernetes, or serverless patterns will maximise agility and scalability.`
          : `Strong gravity (${t.toFixed(2)}) with low complexity (${cx}/5) and clean dependencies (${dp}/5) — the application is well-positioned for cloud-native refactoring with minimal migration risk.`
        : t < 3.5
          ? `Not selected: gravity score of ${t.toFixed(2)} does not reach the Refactor threshold (≥ 3.5). The re-architecture investment is not yet justified — a Replatform or Rehost should come first.`
          : cr < 4
            ? `Not selected: cloud readiness score (${cr}/5) is below the level required to absorb a full re-architecture safely. Improve readiness through Replatforming before considering Refactor.`
            : `Not selected: complexity (${cx}/5) or dependency (${dp}/5) scores are too high to make a clean refactor viable at this stage.`,
    },
    Repurchase: {
      selected: recommended === "Repurchase",
      reason: recommended === "Repurchase"
        ? `Low strategic differentiation (business value: ${bv}/5) means a SaaS equivalent delivers better cloud economics than a custom migration. Replacing this application eliminates ongoing maintenance overhead.`
        : bv >= 3
          ? `Not selected: business value is sufficient (${bv}/5) to justify retaining and migrating this application rather than replacing it with an off-the-shelf SaaS product.`
          : `Not selected: gravity score (${t.toFixed(2)}) falls outside the Repurchase range (2.5–3.49) or another pattern better reflects the overall dimension profile.`,
    },
  };
};

const computeResult = (app: ApplicationInput, weights: Weights = DEFAULT_WEIGHTS): GravityResult => {
  const { scores: s } = app;
  const w = {
    businessValue: s.businessValue * weights.businessValue,
    cloudReadiness: s.cloudReadiness * weights.cloudReadiness,
    complexity: s.complexity * weights.complexity,
    dependencies: s.dependencies * weights.dependencies,
  };
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const band: GravityResult["band"] = total >= 3.5 ? "Highly Applicable" : total >= 2.5 ? "Conditionally Applicable" : "Not Applicable for Cloud";
  const { pattern, rationale } = RECOMMEND_6R(s, total, app.currentPlatform ?? "");
  return {
    totalScore: total, band,
    recommendation6R: pattern,
    targetPlatform: PLATFORM_LOGIC(app.workloadCategory, total, app.currentPlatform ?? ""),
    platformRationale: PLATFORM_RATIONALE(app.workloadCategory, total, app.currentPlatform ?? ""),

    rationale,
    dimensionBreakdown: [
      { dimension: "Business Value",  raw: s.businessValue,  weighted: w.businessValue,  weight: weights.businessValue },
      { dimension: "Cloud Readiness", raw: s.cloudReadiness, weighted: w.cloudReadiness, weight: weights.cloudReadiness },
      { dimension: "Complexity",      raw: s.complexity,     weighted: w.complexity,     weight: weights.complexity },
      { dimension: "Dependencies",    raw: s.dependencies,   weighted: w.dependencies,   weight: weights.dependencies },
    ],
  };
};

// ─── Palette ──────────────────────────────────────────────────────────────────

const BAND_STYLES = {
  "Highly Applicable":        { bg: "#d0e8e8", text: "#01777A", border: "#a0d4d5", dot: "#01777A" },
  "Conditionally Applicable": { bg: "#faecd0", text: "#C1911B", border: "#f0d090", dot: "#C1911B" },
  "Not Applicable for Cloud": { bg: "#fcdbd8", text: "#EC4632", border: "#f5b0a8", dot: "#EC4632" },
};

const PATTERN_COLORS: Record<string, { bg: string; text: string }> = {
  Refactor:   { bg: "#d0e8e8", text: "#01777A" },
  Replatform: { bg: "#dce3d8", text: "#3B4430" },
  Rehost:     { bg: "#e8e3e0", text: "#2F3A4C" },
  Repurchase: { bg: "#d8e0e8", text: "#2F3A4C" },
  Retire:     { bg: "#fcdbd8", text: "#EC4632" },
  Retain:     { bg: "#faecd0", text: "#C1911B" },
};

const scoreColor = (s: number) => s >= 3.5 ? "#01777A" : s >= 2.5 ? "#C1911B" : "#EC4632";

// ─── Small components ─────────────────────────────────────────────────────────

const BandBadge = ({ band, size = "md" }: { band: GravityResult["band"]; size?: "sm" | "md" | "lg" }) => {
  const s = BAND_STYLES[band];
  const cls = size === "lg" ? "px-4 py-1.5 text-sm" : size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${cls}`}
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}>
      <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: s.dot }} />
      {band}
    </span>
  );
};

const PatternBadge = ({ pattern, large }: { pattern: string; large?: boolean }) => {
  const c = PATTERN_COLORS[pattern] ?? { bg: "#e8e3e0", text: "#2F3A4C" };
  return (
    <span className={`inline-block rounded font-bold ${large ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"}`}
      style={{ background: c.bg, color: c.text }}>
      {pattern}
    </span>
  );
};

// ─── Score Gauge (half-circle) ────────────────────────────────────────────────

const ScoreGauge = ({ score }: { score: number }) => {
  const pct = ((score - 1) / 4);
  const color = scoreColor(score);
  const r = 78, cx = 100, cy = 90;
  const startAngle = Math.PI;
  const endAngle = startAngle + pct * Math.PI;
  const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle);
  const trackX2 = cx + r * Math.cos(0),     trackY2 = cy + r * Math.sin(0);
  return (
    <svg viewBox="0 0 200 130" width="100%" style={{ maxWidth: 260 }}>
      {/* Track arc: left → right along top half */}
      <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${trackX2} ${trackY2}`}
        fill="none" stroke="rgba(18,19,15,0.08)" strokeWidth={16} strokeLinecap="round" />
      {/* Filled arc */}
      {pct > 0 && (
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
          fill="none" stroke={color} strokeWidth={16} strokeLinecap="round" />
      )}
      {/* Needle dot at arc tip */}
      {pct > 0 && (
        <circle cx={x2} cy={y2} r={6} fill={color} />
      )}
      {/* Score text — centred in the open bowl below the arc */}
      <text x={cx} y={cy + 10} textAnchor="middle" fill={color}
        fontSize={38} fontWeight={700} fontFamily="JetBrains Mono, monospace">
        {score.toFixed(2)}
      </text>
      <text x={cx} y={cy + 28} textAnchor="middle" fill="rgba(18,19,15,0.4)"
        fontSize={11} fontFamily="Inter, sans-serif">
        out of 5.00
      </text>
      {/* Min/Max labels at arc ends */}
      <text x={x1 + 10} y={y1 + 14} textAnchor="middle" fill="rgba(18,19,15,0.3)" fontSize={9}>1.0</text>
      <text x={trackX2 - 10} y={trackY2 + 14} textAnchor="middle" fill="rgba(18,19,15,0.3)" fontSize={9}>5.0</text>
    </svg>
  );
};

// ─── Spider chart (pure SVG, no recharts) ─────────────────────────────────────

const SpiderChart = ({ axes }: { axes: { label: string; value: number }[] }) => {
  const cx = 110, cy = 110, r = 80, n = axes.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, radius: number) => ({ x: cx + radius * Math.cos(angle(i)), y: cy + radius * Math.sin(angle(i)) });
  const polyPoints = (lvl: number) => axes.map((_, i) => { const p = pt(i, (lvl / 5) * r); return `${p.x},${p.y}`; }).join(" ");
  const dataPoints = axes.map((a, i) => { const p = pt(i, (a.value / 5) * r); return `${p.x},${p.y}`; }).join(" ");
  return (
    <svg viewBox="0 0 220 220" width="100%" height="100%">
      {[1, 2, 3, 4, 5].map(lvl => (
        <polygon key={`g${lvl}`} points={polyPoints(lvl)} fill="none"
          stroke="rgba(18,19,15,0.1)" strokeWidth={lvl === 5 ? 1.5 : 0.8} />
      ))}
      {axes.map((_, i) => {
        const p = pt(i, r);
        return <line key={`s${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(18,19,15,0.1)" strokeWidth={0.8} />;
      })}
      <polygon points={dataPoints} fill="#01777A" fillOpacity={0.12} stroke="#01777A" strokeWidth={2.5} />
      {axes.map((a, i) => {
        const p = pt(i, (a.value / 5) * r);
        return <circle key={`d${i}`} cx={p.x} cy={p.y} r={4} fill="#01777A" />;
      })}
      {axes.map((a, i) => {
        const p = pt(i, r + 18);
        const anchor = p.x < cx - 5 ? "end" : p.x > cx + 5 ? "start" : "middle";
        return (
          <text key={`l${i}`} x={p.x} y={p.y + 4} textAnchor={anchor}
            fontSize={10} fill="#5a6a85" fontFamily="Inter, sans-serif">
            {a.label}
          </text>
        );
      })}
    </svg>
  );
};

// ─── Dimension Slider ─────────────────────────────────────────────────────────

const DimensionSlider = ({ dimension, value, onChange }: {
  dimension: keyof DimensionScore; value: number; onChange: (v: number) => void;
}) => {
  const cfg = SCORE_CRITERIA[dimension];
  const color = scoreColor(value);
  return (
    <div className="rounded-xl p-5 space-y-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold" style={{ color: "var(--foreground)" }}>{cfg.label}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}>
              {(DEFAULT_WEIGHTS[dimension] * 100).toFixed(0)}% weight
            </span>
          </div>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{cfg.description}</p>
        </div>
        <div className="flex-none text-right">
          <div className="text-3xl font-bold tabular-nums leading-none"
            style={{ color, fontFamily: "JetBrains Mono, monospace" }}>{value}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>/ 5</div>
        </div>
      </div>

      {/* Step buttons */}
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => onChange(n)}
            className="flex-1 py-2 rounded-lg text-sm font-bold transition-all"
            style={{
              background: n === value ? color : "var(--secondary)",
              color: n === value ? "#fff" : "var(--muted-foreground)",
              border: n === value ? `1px solid ${color}` : "1px solid var(--border)",
            }}>
            {n}
          </button>
        ))}
      </div>

      {/* Level description */}
      <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
        {cfg.levels[value - 1]}
      </div>
    </div>
  );
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

const CURRENT_PLATFORM_OPTIONS = ["Unknown / Not specified", "On-Premise", "AWS", "GCP", "Azure", "Alibaba Cloud", "Hybrid (On-Premise + AWS)", "Hybrid (On-Premise + GCP)", "Hybrid (On-Premise + Azure)"] as const;

const defaultApp: ApplicationInput = {
  name: "", description: "", owner: "", tier: "Business",
  workloadCategory: WORKLOAD_CATEGORIES[0],
  currentPlatform: CURRENT_PLATFORM_OPTIONS[0],
  scores: { businessValue: 3, cloudReadiness: 3, complexity: 3, dependencies: 3 },
};

// ─── Main Component ───────────────────────────────────────────────────────────

interface GravityScoreToolProps {
  initialWeights?: Weights;
  initialImportRows?: ImportRow[];
  initialImportFileName?: string | null;
  onHome?: () => void;
}

function PortfolioTable({ portfolio, weights, onView }: {
  portfolio: Array<ApplicationInput & { result: GravityResult }>;
  weights: Weights;
  onView: (entry: ApplicationInput & { result: GravityResult }) => void;
}) {
  const [search, setSearch] = useState("");
  const [bandFilter, setBandFilter] = useState("All");
  const [patternFilter, setPatternFilter] = useState("All");
  const [sortCol, setSortCol] = useState<"score" | "name" | "tier" | "pattern" | "band">("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const filtered = portfolio
    .filter(e => {
      if (bandFilter !== "All" && e.result.band !== bandFilter) return false;
      if (patternFilter !== "All" && e.result.recommendation6R !== patternFilter) return false;
      if (search && !e.name.toLowerCase().includes(search.toLowerCase()) && !e.owner.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortCol === "score") cmp = a.result.totalScore - b.result.totalScore;
      else if (sortCol === "name") cmp = a.name.localeCompare(b.name);
      else if (sortCol === "tier") cmp = a.tier.localeCompare(b.tier);
      else if (sortCol === "pattern") cmp = a.result.recommendation6R.localeCompare(b.result.recommendation6R);
      else if (sortCol === "band") cmp = a.result.band.localeCompare(b.result.band);
      return sortDir === "asc" ? cmp : -cmp;
    });

  const bands = ["All", "Highly Applicable", "Conditionally Applicable", "Not Applicable for Cloud"];
  const patterns = ["All", ...Array.from(new Set(portfolio.map(e => e.result.recommendation6R))).sort()];
  const SortIcon = ({ col }: { col: typeof sortCol }) =>
    sortCol === col ? <span style={{ marginLeft: 4, opacity: 0.8 }}>{sortDir === "asc" ? "↑" : "↓"}</span> : <span style={{ marginLeft: 4, opacity: 0.3 }}>↕</span>;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Sticky header: stats + filters */}
      <div style={{ padding: "20px 32px 0", display: "flex", flexDirection: "column", gap: 16, flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { label: "Applications",      value: portfolio.length, mono: false },
            { label: "Avg Gravity Score", value: (portfolio.reduce((a, e) => a + e.result.totalScore, 0) / portfolio.length).toFixed(2), mono: true },
            { label: "Highly Applicable", value: portfolio.filter(e => e.result.band === "Highly Applicable").length, mono: false },
            { label: "Migration Ready",   value: `${Math.round((portfolio.filter(e => e.result.band !== "Not Applicable for Cloud").length / portfolio.length) * 100)}%`, mono: true },
          ].map(s => (
            <div key={s.label} style={{ background: "var(--card)", borderRadius: 10, border: "1px solid var(--border)", padding: "16px 20px" }}>
              <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted-foreground)", marginBottom: 6 }}>{s.label}</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: "var(--accent)", fontFamily: s.mono ? "JetBrains Mono, monospace" : "inherit", lineHeight: 1 }}>{s.value}</p>
            </div>
          ))}
        </div>
        {/* Search + filters */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            placeholder="Search by name or owner…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: "9px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 13, outline: "none" }}
          />
          <select value={bandFilter} onChange={e => setBandFilter(e.target.value)}
            style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12, outline: "none" }}>
            {bands.map(b => <option key={b}>{b === "Conditionally Applicable" ? "Conditional" : b === "Not Applicable for Cloud" ? "Not Applicable" : b}</option>)}
          </select>
          <select value={patternFilter} onChange={e => setPatternFilter(e.target.value)}
            style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12, outline: "none" }}>
            {patterns.map(p => <option key={p}>{p}</option>)}
          </select>
          <span style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
            {filtered.length} of {portfolio.length} apps
          </span>
        </div>
      </div>

      {/* Scrollable table */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto", padding: "16px 32px 32px" }}>
        <table style={{ width: "100%", minWidth: 820, borderCollapse: "collapse", background: "var(--card)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
            <tr style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
              {([
                { label: "Application", col: "name" as const },
                { label: "Tier",        col: "tier" as const },
                { label: "Score",       col: "score" as const },
                { label: "Band",        col: "band" as const },
                { label: "6R Pattern",  col: "pattern" as const },
              ] as const).map(h => (
                <th key={h.col} onClick={() => toggleSort(h.col)}
                  style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                  {h.label}<SortIcon col={h.col} />
                </th>
              ))}
              {["Platform", ""].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, i) => (
              <tr key={entry.name} onClick={() => onView(entry)}
                style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "var(--card)" : "var(--secondary)", cursor: "pointer", transition: "filter 0.1s" }}
                onMouseEnter={e => (e.currentTarget.style.filter = "brightness(0.95)")}
                onMouseLeave={e => (e.currentTarget.style.filter = "brightness(1)")}>
                <td style={{ padding: "12px 16px" }}>
                  <p style={{ fontWeight: 600, fontSize: 13, color: "var(--foreground)" }}>{entry.name}</p>
                  {entry.owner && <p style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{entry.owner}</p>}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{entry.tier}</td>
                <td style={{ padding: "12px 16px", fontWeight: 700, fontSize: 14, fontFamily: "JetBrains Mono, monospace", color: scoreColor(entry.result.totalScore), whiteSpace: "nowrap" }}>
                  {entry.result.totalScore.toFixed(3)}
                </td>
                <td style={{ padding: "12px 16px" }}><BandBadge band={entry.result.band} size="sm" /></td>
                <td style={{ padding: "12px 16px" }}><PatternBadge pattern={entry.result.recommendation6R} /></td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--foreground)", whiteSpace: "nowrap" }}>{entry.result.targetPlatform}</td>
                <td style={{ padding: "12px 16px" }}><span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>View →</span></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>No applications match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function GravityScoreTool({ initialWeights, initialImportRows, initialImportFileName, onHome }: GravityScoreToolProps) {
  const [app, setApp] = useState<ApplicationInput>(defaultApp);
  const [result, setResult] = useState<GravityResult | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(initialImportRows && initialImportRows.length > 0 ? "import" : "score");
  const [viewedFromPortfolio, setViewedFromPortfolio] = useState(false);
  const [nameSearch, setNameSearch] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [portfolio, setPortfolio] = useState<Array<ApplicationInput & { result: GravityResult }>>(() =>
    lsLoad("cgf_portfolio", [] as Array<ApplicationInput & { result: GravityResult }>)
  );
  const [importRows, setImportRows] = useState<ImportRow[]>(() =>
    initialImportRows && initialImportRows.length > 0
      ? initialImportRows
      : lsLoad("cgf_toolImportRows", [] as ImportRow[])
  );
  const [importFileName, setImportFileName] = useState<string | null>(() =>
    initialImportFileName ?? lsLoad("cgf_toolImportFileName", null)
  );
  const [xlsxHeaders, setXlsxHeaders] = useState<string[]>([]);
  const [xlsxRawRows, setXlsxRawRows] = useState<Record<string, unknown>[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [weights, setWeights] = useState<Weights>(() =>
    initialWeights ?? lsLoad("cgf_toolWeights", DEFAULT_WEIGHTS)
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Recompute all results on mount so stale localStorage entries always reflect current logic
  useEffect(() => {
    setPortfolio(p => p.map(e => ({ ...e, currentPlatform: e.currentPlatform ?? "Unknown / Not specified", result: computeResult({ ...e, currentPlatform: e.currentPlatform ?? "Unknown / Not specified" }, weights) })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { lsSave("cgf_portfolio", portfolio); }, [portfolio]);
  useEffect(() => { lsSave("cgf_toolImportRows", importRows); }, [importRows]);
  useEffect(() => { lsSave("cgf_toolImportFileName", importFileName); }, [importFileName]);
  useEffect(() => { lsSave("cgf_toolWeights", weights); }, [weights]);

  const weightTotal = weights.businessValue + weights.cloudReadiness + weights.complexity + weights.dependencies;

  const setWeight = (dim: keyof Weights, pct: number) => {
    setWeights(w => ({ ...w, [dim]: Math.round(pct) / 100 }));
  };

  const liveScore =
    app.scores.businessValue * weights.businessValue +
    app.scores.cloudReadiness * weights.cloudReadiness +
    app.scores.complexity * weights.complexity +
    app.scores.dependencies * weights.dependencies;
  const liveColor = scoreColor(liveScore);
  const liveBand: GravityResult["band"] = liveScore >= 3.5 ? "Highly Applicable" : liveScore >= 2.5 ? "Conditionally Applicable" : "Not Applicable for Cloud";

  const setScore = (dim: keyof DimensionScore, v: number) =>
    setApp(a => ({ ...a, scores: { ...a.scores, [dim]: v } }));

  const handleCalculate = useCallback(() => {
    setResult(computeResult(app, weights));
    setActiveTab("result");
  }, [app, weights]);

  const addToPortfolio = () => {
    if (!result || !app.name) return;
    setPortfolio(p => [...p.filter(e => e.name !== app.name), { ...app, result }]);
    setApp(defaultApp);
    setResult(null);
    setActiveTab("portfolio");
  };

  const clampScore = (v: unknown): number => {
    const n = Number(v);
    if (isNaN(n)) return 0;
    return Math.min(5, Math.max(1, Math.round(n)));
  };

  const parseFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const XLSX = await import("xlsx");
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      // Case-insensitive column lookup — handles any casing/spacing variation in xlsx headers
      const col = (row: Record<string, unknown>, ...candidates: string[]): unknown => {
        const keys = Object.keys(row);
        for (const candidate of candidates) {
          const norm = candidate.toLowerCase().replace(/\s+/g, " ").trim();
          const match = keys.find(k => k.toLowerCase().replace(/\s+/g, " ").trim() === norm);
          if (match !== undefined && row[match] !== "" && row[match] !== undefined) return row[match];
        }
        return "";
      };
      if (rows.length > 0) {
        const headers = Object.keys(rows[0] as Record<string, unknown>);
        setXlsxHeaders(headers);
        setXlsxRawRows(rows as Record<string, unknown>[]);
        // Log exact headers and first row so we can diagnose column mismatches
        console.log("[CGF Import] Headers found:", headers);
        console.log("[CGF Import] First row raw values:", rows[0]);
      }
      const parsed: ImportRow[] = rows.map(row => {
        const errors: string[] = [];

        const name        = String(col(row, "Application Name", "Name", "App Name", "Application") ?? "").trim();
        const owner       = String(col(row, "Owner", "Division", "Application Owner") ?? "").trim();
        const tier        = String(col(row, "Tier", "Application Tier", "App Tier") ?? "").trim();
        const rawCategory = String(col(row, "Workload Category", "WorkloadCategory", "Category") ?? "").trim();
        const rawHosting  = String(col(row, "Current Hosting Location", "CurrentHostingLocation", "Current Hosting", "Hosting Location", "Hosting Platform", "Current Platform", "CurrentPlatform", "Current Cloud", "Cloud Provider", "Platform", "Hosting", "Location") ?? "").trim();
        const description = String(col(row, "Description", "App Description", "Details") ?? "").trim();
        const bv = clampScore(col(row, "Business Value", "BV", "BusinessValue"));
        const cr = clampScore(col(row, "Cloud Readiness", "CR", "CloudReadiness", "Cloud Ready"));
        const cx = clampScore(col(row, "Complexity", "CX", "Cx", "Complex"));
        const dp = clampScore(col(row, "Dependencies", "DP", "Dep", "Dependency"));

        if (!name)        errors.push("Missing: Application Name");
        if (!owner)       errors.push("Missing: Owner");
        if (!tier)        errors.push("Missing: Tier");
        if (!rawCategory) errors.push("Missing: Workload Category");
        if (!rawHosting)  errors.push("Missing: Current Hosting Location");
        if (!description) errors.push("Missing: Description");
        if (!bv) errors.push("Missing: Business Value (1–5)");
        if (!cr) errors.push("Missing: Cloud Readiness (1–5)");
        if (!cx) errors.push("Missing: Complexity (1–5)");
        if (!dp) errors.push("Missing: Dependencies (1–5)");

        const workloadCategory = (WORKLOAD_CATEGORIES as readonly string[]).includes(rawCategory)
          ? rawCategory : WORKLOAD_CATEGORIES[0];

        return {
          name,
          owner,
          tier: tier || "Business",
          workloadCategory,
          currentPlatform: rawHosting || "Unknown / Not specified",
          description,
          scores: { businessValue: bv || 3, cloudReadiness: cr || 3, complexity: cx || 3, dependencies: dp || 3 },
          valid: errors.length === 0,
          errors,
        };
      });
      setImportRows(parsed);
      setImportFileName(file.name);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const commitImport = () => {
    const scored = importRows.filter(r => r.valid).map(r => {
      const appInput: ApplicationInput = { name: r.name, owner: r.owner, tier: r.tier, workloadCategory: r.workloadCategory, currentPlatform: r.currentPlatform ?? "Unknown / Not specified", description: r.description, scores: r.scores };
      return { ...r, result: computeResult(appInput, weights) };
    });
    setPortfolio(p => [...p.filter(e => !scored.find(s => s.name === e.name)), ...scored]);
    setImportRows([]); setImportFileName(null);
    setActiveTab("portfolio");
  };

  const spiderAxes = [
    { label: "Biz Value",   value: app.scores.businessValue },
    { label: "Cloud Ready", value: app.scores.cloudReadiness },
    { label: "Complexity",  value: app.scores.complexity },
    { label: "Depend.",     value: app.scores.dependencies },
  ];

  const NAV_ITEMS: { id: Tab; label: string; icon: string; badge: number | null }[] = [
    { id: "score",     label: "Score Application", icon: "◎", badge: null },
    { id: "result",    label: "Assessment Result",  icon: "◈", badge: null },
    { id: "import",    label: "Bulk Import",        icon: "⊕", badge: importRows.length > 0 ? importRows.length : null },
    { id: "portfolio", label: "Portfolio",          icon: "▦", badge: portfolio.length > 0 ? portfolio.length : null },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", overflow: "auto", minWidth: 800, background: "var(--background)" }}>

      {/* ── HEADER ── */}
      <header style={{ flexShrink: 0, background: "var(--primary)", color: "var(--primary-foreground)", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {onHome && (
            <button onClick={onHome} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(242,237,235,0.6)", fontSize: 12, cursor: "pointer" }}>
              ← Home
            </button>
          )}
          <ImageWithFallback src={ollionLogo} alt="Ollion" style={{ height: 20, width: "auto", objectFit: "contain", filter: "brightness(0) invert(1)" }} />
          <span style={{ width: 1, height: 14, background: "rgba(255,255,255,0.15)" }} />
          <span style={{ fontWeight: 600, fontSize: 15, color: "var(--primary-foreground)" }}>Workload Placement Framework</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 12, color: "rgba(242,237,235,0.45)" }}>
          <span>AWS · GCP · Azure · On-Prem</span>
          <span style={{ width: 1, height: 12, background: "rgba(255,255,255,0.15)" }} />
          <span>6R Migration Patterns</span>
          <span style={{ width: 1, height: 12, background: "rgba(255,255,255,0.15)" }} />
          <span>Cloud Migration Advisory</span>
        </div>
      </header>

      {/* ── BODY ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* ── SIDEBAR ── */}
        <aside style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", background: "#1a242f", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
          <nav style={{ padding: "16px 12px 0", display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV_ITEMS.map(item => (
              <button key={item.id} onClick={() => { setActiveTab(item.id); if (item.id !== "result") setViewedFromPortfolio(false); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: activeTab === item.id ? "var(--accent)" : "transparent",
                  color: activeTab === item.id ? "#fff" : "rgba(242,237,235,0.5)",
                  fontSize: 13, fontWeight: activeTab === item.id ? 600 : 400,
                  transition: "all 0.15s",
                }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ fontSize: 15, lineHeight: 1 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge !== null && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "rgba(255,255,255,0.15)", color: "rgba(242,237,235,0.85)" }}>
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div style={{ flex: 1 }} />

          {/* Live score widget */}
          <div style={{ margin: "0 12px 10px", padding: "14px 14px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(242,237,235,0.35)", marginBottom: 8 }}>Live Score</p>
            <p style={{ fontSize: 32, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: liveColor, lineHeight: 1, marginBottom: 8 }}>
              {liveScore.toFixed(2)}
            </p>
            <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,0.08)", marginBottom: 8 }}>
              <div style={{ height: "100%", borderRadius: 999, width: `${((liveScore - 1) / 4) * 100}%`, background: liveColor, transition: "width 0.3s, background 0.3s" }} />
            </div>
            <BandBadge band={liveBand} size="sm" />
          </div>

          {/* Bands legend */}
          <div style={{ margin: "0 12px 12px", padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(242,237,235,0.25)", marginBottom: 10 }}>Score Bands</p>
            {[
              { l: "Highly Applicable", r: "≥ 3.5", c: "#01777A" },
              { l: "Conditional", r: "2.5 – 3.49", c: "#C1911B" },
              { l: "Not Applicable", r: "< 2.5", c: "#EC4632" },
            ].map(b => (
              <div key={b.l} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: b.c, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: "rgba(242,237,235,0.5)" }}>{b.l}</span>
                </div>
                <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "rgba(242,237,235,0.25)" }}>{b.r}</span>
              </div>
            ))}
          </div>

          <div style={{ padding: "10px 16px 12px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <p style={{ fontSize: 11, color: "rgba(242,237,235,0.2)", lineHeight: 1.5 }}>Ollion · Workload Placement Framework</p>
            <p style={{ fontSize: 10, color: "rgba(242,237,235,0.15)" }}>
              BV {Math.round(weights.businessValue * 100)}% · CR {Math.round(weights.cloudReadiness * 100)}% · CX {Math.round(weights.complexity * 100)}% · DP {Math.round(weights.dependencies * 100)}%
            </p>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* ══ SCORE TAB ══ */}
          {activeTab === "score" && (
            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
              {/* Form column */}
              <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24 }}>

                {/* App details */}
                <div>
                  <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted-foreground)", marginBottom: 14 }}>Application Details</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div style={{ gridColumn: "span 2", position: "relative" }}>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", marginBottom: 6 }}>
                        Application Name *
                        {(portfolio.length > 0 || importRows.filter(r => r.valid).length > 0) && (
                          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: "var(--accent)", textTransform: "none", letterSpacing: 0 }}>
                            — type to search {portfolio.length + importRows.filter(r => r.valid).length} imported apps
                          </span>
                        )}
                      </label>
                      <input
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                        placeholder="e.g. OCTO Mobile, Core LOS, EDP-01"
                        value={app.name}
                        autoComplete="off"
                        onChange={e => {
                          const val = e.target.value;
                          setApp(a => ({ ...a, name: val }));
                          setNameSearch(val);
                          setShowSuggestions(val.trim().length > 0);
                        }}
                        onFocus={() => { if (app.name.trim().length > 0) setShowSuggestions(true); }}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                      />
                      {/* Autocomplete dropdown */}
                      {showSuggestions && (() => {
                        const allApps: ApplicationInput[] = [
                          ...portfolio.map(e => ({ name: e.name, owner: e.owner, tier: e.tier, workloadCategory: e.workloadCategory, currentPlatform: e.currentPlatform ?? "Unknown / Not specified", description: e.description, scores: e.scores })),
                          ...importRows.filter(r => r.valid).map(r => ({ name: r.name, owner: r.owner, tier: r.tier, workloadCategory: r.workloadCategory, currentPlatform: r.currentPlatform ?? "Unknown / Not specified", description: r.description, scores: r.scores })),
                        ];
                        const seen = new Set<string>();
                        const unique = allApps.filter(a => { if (seen.has(a.name)) return false; seen.add(a.name); return true; });
                        const q = nameSearch.toLowerCase();
                        const matches = unique.filter(a => a.name.toLowerCase().includes(q));
                        if (matches.length === 0) return null;
                        return (
                          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, marginTop: 4, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", overflow: "hidden" }}>
                            <div style={{ padding: "6px 12px 4px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)" }}>Imported Applications</span>
                              <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{matches.length} match{matches.length !== 1 ? "es" : ""}</span>
                            </div>
                            {matches.slice(0, 8).map(match => (
                              <button
                                key={match.name}
                                onMouseDown={() => {
                                  setApp({ name: match.name, owner: match.owner, tier: match.tier, workloadCategory: match.workloadCategory, currentPlatform: match.currentPlatform ?? "Unknown / Not specified", description: match.description, scores: match.scores });
                                  setNameSearch(match.name);
                                  setShowSuggestions(false);
                                }}
                                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 14px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                                onMouseEnter={e => (e.currentTarget.style.background = "var(--secondary)")}
                                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                              >
                                <div>
                                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>{match.name}</p>
                                  {match.owner && <p style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{match.owner} · {match.tier}</p>}
                                </div>
                                <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "var(--accent)", color: "#fff", fontWeight: 600, flexShrink: 0, marginLeft: 12 }}>Load</span>
                              </button>
                            ))}
                            {matches.length > 8 && (
                              <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--muted-foreground)" }}>
                                +{matches.length - 8} more — keep typing to narrow results
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", marginBottom: 6 }}>Owner / Division</label>
                      <input
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                        placeholder="e.g. Digital Banking"
                        value={app.owner}
                        onChange={e => setApp(a => ({ ...a, owner: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", marginBottom: 6 }}>Application Tier</label>
                      <select
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 14, outline: "none" }}
                        value={app.tier} onChange={e => setApp(a => ({ ...a, tier: e.target.value }))}>
                        {["Core Banking", "Business", "Digital Channel", "Analytics", "Infrastructure", "Sharia / Subsidiary"].map(t => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ gridColumn: "span 2" }}>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", marginBottom: 6 }}>
                        Workload Category
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: "var(--accent)", textTransform: "none", letterSpacing: 0 }}>— determines target platform placement</span>
                      </label>
                      <select
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 14, outline: "none" }}
                        value={app.workloadCategory} onChange={e => setApp(a => ({ ...a, workloadCategory: e.target.value }))}>
                        {WORKLOAD_CATEGORIES.map(c => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", marginBottom: 6 }}>
                        Current Platform
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: "var(--accent)", textTransform: "none", letterSpacing: 0 }}>— avoids unnecessary cross-cloud migrations</span>
                      </label>
                      <select
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 14, outline: "none" }}
                        value={app.currentPlatform} onChange={e => setApp(a => ({ ...a, currentPlatform: e.target.value }))}>
                        {(CURRENT_PLATFORM_OPTIONS as readonly string[]).includes(app.currentPlatform) ? null : (
                          <option key={app.currentPlatform} value={app.currentPlatform}>{app.currentPlatform}</option>
                        )}
                        {CURRENT_PLATFORM_OPTIONS.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", marginBottom: 6 }}>Description</label>
                      <input
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 14, outline: "none" }}
                        placeholder="Brief functional description"
                        value={app.description} onChange={e => setApp(a => ({ ...a, description: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div style={{ borderTop: "1px solid var(--border)" }} />

                {/* Scoring dimensions */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted-foreground)" }}>Weighted Scoring Dimensions</p>
                    <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "var(--muted)", color: "var(--muted-foreground)" }}>Click a score 1–5</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    {(Object.keys(DEFAULT_WEIGHTS) as (keyof DimensionScore)[]).map(dim => (
                      <DimensionSlider key={dim} dimension={dim} value={app.scores[dim]} onChange={v => setScore(dim, v)} />
                    ))}
                  </div>
                </div>

                {/* CTA */}
                <button onClick={handleCalculate} disabled={Math.abs(weightTotal - 1) >= 0.001}
                  style={{ padding: "14px 24px", borderRadius: 10, border: "none", cursor: Math.abs(weightTotal - 1) < 0.001 ? "pointer" : "not-allowed", background: "var(--accent)", color: "#fff", fontSize: 15, fontWeight: 600, transition: "opacity 0.15s", marginBottom: 8, opacity: Math.abs(weightTotal - 1) < 0.001 ? 1 : 0.4 }}>
                  Calculate Gravity Score →
                </button>
              </div>

              {/* Preview panel */}
              <div style={{ width: 300, flexShrink: 0, overflowY: "auto", background: "var(--card)", borderLeft: "1px solid var(--border)", padding: "28px 20px", display: "flex", flexDirection: "column", gap: 24 }}>
                <div>
                  <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted-foreground)", marginBottom: 12 }}>Score Radar</p>
                  <div style={{ width: "100%", aspectRatio: "1/1" }}>
                    <SpiderChart axes={spiderAxes} />
                  </div>
                </div>

                <div style={{ borderTop: "1px solid var(--border)" }} />

                <div>
                  <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted-foreground)", marginBottom: 14 }}>Weight Breakdown</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {(Object.keys(DEFAULT_WEIGHTS) as (keyof DimensionScore)[]).map(dim => {
                      const weighted = app.scores[dim] * weights[dim];
                      return (
                        <div key={dim}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                            <span style={{ fontSize: 12, color: "var(--foreground)" }}>{SCORE_CRITERIA[dim].label}</span>
                            <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--muted-foreground)" }}>
                              {app.scores[dim]} × {(weights[dim] * 100).toFixed(0)}% = <strong style={{ color: "var(--accent)" }}>{weighted.toFixed(2)}</strong>
                            </span>
                          </div>
                          <div style={{ height: 6, borderRadius: 999, background: "var(--muted)" }}>
                            <div style={{ height: "100%", borderRadius: 999, width: `${(app.scores[dim] / 5) * 100}%`, background: "var(--accent)", transition: "width 0.3s" }} />
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>Indicative Total</span>
                      <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: liveColor }}>{liveScore.toFixed(3)}</span>
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid var(--border)" }} />

                <div>
                  <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted-foreground)", marginBottom: 12 }}>6R Patterns</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {Object.keys(PATTERN_COLORS).map(p => <PatternBadge key={p} pattern={p} />)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══ RESULT TAB ══ */}
          {activeTab === "result" && result && (
            <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24 }}>

              {/* Back to Portfolio */}
              {viewedFromPortfolio && (
                <div>
                  <button
                    onClick={() => { setViewedFromPortfolio(false); setActiveTab("portfolio"); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
                  >
                    ← Back to Portfolio
                  </button>
                </div>
              )}

              {/* Hero row */}
              <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20 }}>
                {/* Gauge */}
                <div style={{ background: "var(--card)", borderRadius: 16, border: "1px solid var(--border)", padding: "28px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                  <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted-foreground)", textAlign: "center" }}>
                    {app.name || "Application"}<br />
                    <span style={{ fontSize: 10, opacity: 0.7 }}>{app.tier}</span>
                  </p>
                  <ScoreGauge score={result.totalScore} />
                  <BandBadge band={result.band} size="md" />
                </div>

                {/* Stats grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 16 }}>
                  {[
                    { label: "6R Pattern",      node: (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <PatternBadge pattern={result.recommendation6R} large />
                        <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.55, fontStyle: "italic" }}>{result.rationale}</span>
                      </div>
                    ) },
                    { label: "Target Platform", node: (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground)" }}>{result.targetPlatform}</span>
                        <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.55, fontStyle: "italic" }}>{result.platformRationale}</span>
                      </div>
                    ) },
                    { label: "Gravity Score",   node: <span style={{ fontSize: 28, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: scoreColor(result.totalScore) }}>{result.totalScore.toFixed(3)}</span> },
                  ].map(s => (
                    <div key={s.label} style={{ background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted-foreground)" }}>{s.label}</p>
                      <div>{s.node}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rationale banner */}
              <div style={{ background: "var(--card)", borderRadius: 12, borderLeft: "4px solid var(--accent)", padding: "16px 20px" }}>
                <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted-foreground)", marginBottom: 6 }}>Assessment Rationale</p>
                <p style={{ fontSize: 14, color: "var(--foreground)", lineHeight: 1.6 }}>{result.rationale}</p>
              </div>

              {/* Breakdown + bar chart */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {/* Table */}
                <div style={{ background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", background: "var(--secondary)" }}>
                    <p style={{ fontWeight: 600, color: "var(--foreground)" }}>Score Breakdown</p>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "var(--muted)" }}>
                        {["Dimension", "Weight", "Raw", "Weighted"].map(h => (
                          <th key={h} style={{ padding: "8px 16px", textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.dimensionBreakdown.map((row, i) => (
                        <tr key={row.dimension} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "var(--card)" : "var(--secondary)" }}>
                          <td style={{ padding: "11px 16px", fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>{row.dimension}</td>
                          <td style={{ padding: "11px 16px", fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "var(--muted-foreground)" }}>{(row.weight * 100).toFixed(0)}%</td>
                          <td style={{ padding: "11px 16px", fontSize: 13, fontFamily: "JetBrains Mono, monospace", color: "var(--foreground)" }}>{row.raw}/5</td>
                          <td style={{ padding: "11px 16px", fontSize: 13, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: "var(--accent)" }}>{row.weighted.toFixed(3)}</td>
                        </tr>
                      ))}
                      <tr style={{ background: "var(--primary)" }}>
                        <td colSpan={3} style={{ padding: "11px 16px", fontSize: 13, fontWeight: 700, color: "var(--primary-foreground)" }}>Total Gravity Score</td>
                        <td style={{ padding: "11px 16px", fontSize: 16, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: "var(--primary-foreground)" }}>{result.totalScore.toFixed(3)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Bar chart */}
                <div style={{ background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", padding: "20px 20px 16px" }}>
                  <p style={{ fontWeight: 600, color: "var(--foreground)", marginBottom: 16 }}>Weighted Contributions</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={result.dimensionBreakdown} layout="vertical" margin={{ left: 16, right: 24 }}>
                      <XAxis type="number" domain={[0, 2]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                      <YAxis type="category" dataKey="dimension" width={100} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                      <Tooltip formatter={(v: number) => v.toFixed(3)} contentStyle={{ fontSize: 12, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                      <Bar key="weighted" dataKey="weighted" name="Weighted Score" radius={4} fill="#01777A" fillOpacity={0.8} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 6R grid */}
              <div style={{ background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", padding: "20px 24px" }}>
                <p style={{ fontWeight: 600, color: "var(--foreground)", marginBottom: 16 }}>6R Pattern Decision Breakdown</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  {(() => {
                    const bd = result.dimensionBreakdown;
                    const rawScores: DimensionScore = {
                      businessValue:  bd.find(d => d.dimension === "Business Value")?.raw  ?? 3,
                      cloudReadiness: bd.find(d => d.dimension === "Cloud Readiness")?.raw ?? 3,
                      complexity:     bd.find(d => d.dimension === "Complexity")?.raw      ?? 3,
                      dependencies:   bd.find(d => d.dimension === "Dependencies")?.raw    ?? 3,
                    };
                    const explanations = EXPLAIN_6R(rawScores, result.totalScore, result.recommendation6R, app.currentPlatform ?? "");
                    return ["Rehost", "Replatform", "Refactor", "Repurchase", "Retire", "Retain"].map(r => {
                      const { selected, reason } = explanations[r];
                      return (
                        <div key={r} style={{
                          borderRadius: 10, padding: "14px 16px", border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                          background: selected ? "var(--secondary)" : "transparent", display: "flex", flexDirection: "column", gap: 8,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <PatternBadge pattern={r} />
                            {selected
                              ? <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>✓ Selected</span>
                              : <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>✗ Not selected</span>
                            }
                          </div>
                          <p style={{ fontSize: 11.5, color: selected ? "var(--foreground)" : "var(--muted-foreground)", lineHeight: 1.55, fontStyle: "italic" }}>{reason}</p>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 12, paddingBottom: 8 }}>
                <button onClick={() => setActiveTab("score")}
                  style={{ padding: "11px 22px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  ← Score Another
                </button>
                <button onClick={addToPortfolio} disabled={!app.name}
                  style={{ padding: "11px 22px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: app.name ? 1 : 0.4 }}>
                  Add to Portfolio →
                </button>
              </div>
            </div>
          )}

          {activeTab === "result" && !result && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, color: "var(--muted-foreground)" }}>
              <p style={{ fontSize: 18 }}>No assessment yet</p>
              <button onClick={() => setActiveTab("score")}
                style={{ padding: "11px 22px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Score an Application
              </button>
            </div>
          )}

          {/* ══ IMPORT TAB ══ */}
          {activeTab === "import" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
              <div>
                <h2 style={{ color: "var(--foreground)", marginBottom: 6 }}>Bulk Import Applications</h2>
                <p style={{ fontSize: 14, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
                  Upload an <strong>.xlsx</strong>, <strong>.xls</strong>, or <strong>.csv</strong> file — one application per row.
                  All applications are scored automatically against the gravity framework.
                </p>
              </div>

              {/* Drop zone — always visible so user can re-upload */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f); }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  borderRadius: 16, border: `2px dashed ${dragOver ? "var(--accent)" : importFileName ? "var(--accent)" : "var(--border)"}`,
                  background: dragOver ? "rgba(1,119,122,0.05)" : importFileName ? "rgba(1,119,122,0.03)" : "var(--card)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 12, padding: "32px", cursor: "pointer", transition: "all 0.2s",
                }}>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
                <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "var(--accent)" }}>
                  {importFileName ? "📄" : "⊕"}
                </div>
                <div style={{ textAlign: "center" }}>
                  {importFileName
                    ? <p style={{ fontWeight: 600, fontSize: 14, color: "var(--accent)", marginBottom: 2 }}>{importFileName} — click to replace</p>
                    : <p style={{ fontWeight: 600, fontSize: 15, color: "var(--foreground)", marginBottom: 2 }}>Drop your file here, or click to browse</p>
                  }
                  <p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Supports .xlsx · .xls · .csv</p>
                </div>
              </div>

              {/* Empty parse result warning */}
              {importFileName && importRows.length === 0 && (
                <div style={{ background: "#fcdbd8", border: "1px solid #EC4632", borderRadius: 10, padding: "16px 20px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 20, color: "#EC4632" }}>⚠</span>
                  <div>
                    <p style={{ fontWeight: 600, color: "#EC4632", marginBottom: 4 }}>No rows found in "{importFileName}"</p>
                    <p style={{ fontSize: 12, color: "#9B2A1A", lineHeight: 1.6 }}>
                      The file was read but contained no data rows. Check that:<br />
                      · The data is on the <strong>first sheet</strong><br />
                      · Row 1 contains column headers (not a title row or merged cells)<br />
                      · The file is not empty or password-protected
                    </p>
                  </div>
                </div>
              )}

              {(!importFileName) && (
                <>

                  {/* Column guide */}
                  <div style={{ background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", padding: "20px 24px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                      <p style={{ fontWeight: 600, color: "var(--foreground)" }}>Expected Column Headers</p>
                      <button onClick={async () => {
                        const XLSX = await import("xlsx");
                        const ws = XLSX.utils.aoa_to_sheet([
                          ["Application Name", "Owner", "Tier", "Workload Category", "Description", "Business Value", "Cloud Readiness", "Complexity", "Dependencies"],
                          ["OCTO Mobile", "Digital Banking", "Digital Channel", "Digital and mobile banking / containerised microservices", "Mobile banking app", 5, 4, 3, 4],
                          ["EDP-01", "Data Platform", "Analytics", "Data, analytics, and AI workloads", "Enterprise data platform", 4, 4, 2, 3],
                          ["Core LOS", "Lending", "Core Banking", "Core banking & payments", "Loan origination system", 5, 2, 1, 2],
                        ]);
                        const wb = XLSX.utils.book_new();
                        XLSX.utils.book_append_sheet(wb, ws, "Applications");
                        XLSX.writeFile(wb, "ollion-gravity-template.xlsx");
                      }}
                        style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        ↓ Download Template
                      </button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 32px" }}>
                      {[
                        { field: "Application Name *", aliases: "Application Name · Name · App Name" },
                        { field: "Business Value *",    aliases: "Business Value · BV · BusinessValue" },
                        { field: "Owner",               aliases: "Owner · Division" },
                        { field: "Cloud Readiness *",   aliases: "Cloud Readiness · CR · CloudReadiness" },
                        { field: "Tier",                aliases: "Tier · Application Tier" },
                        { field: "Complexity *",        aliases: "Complexity · CX · Cx" },
                        { field: "Workload Category",   aliases: "Workload Category · WorkloadCategory · Category" },
                        { field: "Dependencies *",      aliases: "Dependencies · DP · Dep" },
                        { field: "Description",         aliases: "Description" },
                        { field: "",                    aliases: "" },
                      ].filter(c => c.field).map(col => (
                        <div key={col.field} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                          <span style={{ fontSize: 12, fontWeight: 700, width: 140, flexShrink: 0, color: "var(--foreground)" }}>{col.field}</span>
                          <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--muted-foreground)" }}>{col.aliases}</span>
                        </div>
                      ))}
                    </div>
                    <p style={{ marginTop: 14, fontSize: 12, color: "var(--muted-foreground)" }}>* Required. Score columns must be integers 1–5. If Workload Category is omitted, defaults to "Customer-facing digital".</p>
                    <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: "var(--secondary)", border: "1px solid var(--border)" }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 8 }}>Valid Workload Category values:</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {WORKLOAD_CATEGORIES.map(c => (
                          <span key={c} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted-foreground)", fontFamily: "JetBrains Mono, monospace" }}>{c}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {importFileName && importRows.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* File bar */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", padding: "14px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 24 }}>📄</span>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: 14, color: "var(--foreground)" }}>{importFileName}</p>
                        <p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                          {importRows.length} rows · {importRows.filter(r => r.valid).length} valid · {importRows.filter(r => !r.valid).length} errors
                        </p>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => { setImportRows([]); setImportFileName(null); setXlsxHeaders([]); setXlsxRawRows([]); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                        style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                        Clear Import
                      </button>
                      <button onClick={() => {
                        if (!window.confirm("This will permanently delete all imported applications from the portfolio. Continue?")) return;
                        setImportRows([]); setImportFileName(null); setXlsxHeaders([]); setXlsxRawRows([]);
                        setPortfolio([]);
                        ["cgf_portfolio", "cgf_toolImportRows", "cgf_toolImportFileName"].forEach(k => localStorage.removeItem(k));
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                        style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #EC4632", background: "transparent", color: "#EC4632", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                        Clear All Data
                      </button>
                      <button onClick={commitImport} disabled={importRows.filter(r => r.valid).length === 0}
                        style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: importRows.filter(r => r.valid).length > 0 ? 1 : 0.4 }}>
                        Import {importRows.filter(r => r.valid).length} Apps →
                      </button>
                    </div>
                  </div>

                  {/* Summary pills */}
                  <div style={{ display: "flex", gap: 10 }}>
                    {[
                      { label: "Total",      value: importRows.length,                      bg: "var(--secondary)", color: "var(--foreground)" },
                      { label: "Complete",   value: importRows.filter(r => r.valid).length, bg: "#d0e8e8",          color: "#01777A" },
                      { label: "Incomplete", value: importRows.filter(r => !r.valid).length, bg: "#fcdbd8",         color: "#EC4632" },
                    ].map(s => (
                      <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8, background: s.bg }}>
                        <span style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "JetBrains Mono, monospace" }}>{s.value}</span>
                        <span style={{ fontSize: 12, color: s.color }}>{s.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Preview table — all xlsx columns + computed columns */}
                  {xlsxHeaders.length > 0 && (
                    <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", background: "var(--card)" }}>
                      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--secondary)", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)" }}>
                          {xlsxHeaders.length} columns detected
                        </span>
                        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>· Scroll horizontally to see all · Computed columns appended at right</span>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
                              {/* Status */}
                              <th style={{ padding: "10px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--primary)", zIndex: 1 }}></th>
                              {/* All raw xlsx columns */}
                              {xlsxHeaders.map(h => (
                                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, whiteSpace: "nowrap", borderLeft: "1px solid rgba(255,255,255,0.1)" }}>{h}</th>
                              ))}
                              {/* Computed columns */}
                              {["Est. Score", "Est. Band"].map(h => (
                                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, whiteSpace: "nowrap", borderLeft: "2px solid rgba(255,255,255,0.3)", background: "rgba(0,0,0,0.15)" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {importRows.map((row, i) => {
                              const rawRow = xlsxRawRows[i] ?? {};
                              const est = row.scores.businessValue * weights.businessValue + row.scores.cloudReadiness * weights.cloudReadiness + row.scores.complexity * weights.complexity + row.scores.dependencies * weights.dependencies;
                              const estBand: GravityResult["band"] = est >= 3.5 ? "Highly Applicable" : est >= 2.5 ? "Conditionally Applicable" : "Not Applicable for Cloud";
                              const bS = BAND_STYLES[estBand];
                              return (
                                <tr key={i} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "var(--card)" : "var(--secondary)" }}>
                                  {/* Status cell */}
                                  <td style={{ padding: "8px 12px", position: "sticky", left: 0, background: i % 2 === 0 ? "var(--card)" : "var(--secondary)", zIndex: 1, borderRight: "1px solid var(--border)", minWidth: 160, verticalAlign: "top" }}>
                                    {row.valid ? (
                                      <span style={{ fontSize: 11, fontWeight: 700, color: "#01777A" }}>✓ Complete</span>
                                    ) : (
                                      <div>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: "#EC4632" }}>✗ {row.errors.length} issue{row.errors.length > 1 ? "s" : ""}</span>
                                        {row.errors.map(err => (
                                          <p key={err} style={{ fontSize: 10, color: "#EC4632", marginTop: 2, whiteSpace: "nowrap" }}>{err}</p>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  {/* All raw xlsx column values */}
                                  {xlsxHeaders.map(h => {
                                    const val = String(rawRow[h] ?? "").trim();
                                    const isHosting = detectCloudProvider(val) !== null;
                                    const isScore = ["1","2","3","4","5"].includes(val);
                                    return (
                                      <td key={h} style={{ padding: "10px 14px", borderLeft: "1px solid var(--border)", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={val}>
                                        {val === "" ? (
                                          <em style={{ opacity: 0.35, color: "var(--muted-foreground)", fontSize: 11 }}>—</em>
                                        ) : isScore ? (
                                          <span style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: "var(--accent)" }}>{val}</span>
                                        ) : isHosting ? (
                                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "rgba(1,119,122,0.12)", color: "var(--accent)" }}>{detectCloudProvider(val)}</span>
                                            <span style={{ fontSize: 11, color: "var(--foreground)" }}>{val}</span>
                                          </span>
                                        ) : (
                                          <span style={{ fontSize: 12, color: "var(--foreground)" }}>{val}</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                  {/* Computed: Est. Score */}
                                  <td style={{ padding: "10px 14px", textAlign: "center", fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: scoreColor(est), borderLeft: "2px solid var(--border)", background: "rgba(1,119,122,0.04)" }}>
                                    {row.valid ? est.toFixed(2) : "—"}
                                  </td>
                                  {/* Computed: Est. Band */}
                                  <td style={{ padding: "10px 14px", borderLeft: "1px solid var(--border)", background: "rgba(1,119,122,0.04)" }}>
                                    {row.valid && (
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: bS.bg, color: bS.text, border: `1px solid ${bS.border}`, whiteSpace: "nowrap" }}>
                                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: bS.dot }} />
                                        {estBand === "Conditionally Applicable" ? "Conditional" : estBand === "Not Applicable for Cloud" ? "Not Applicable" : "Highly Applicable"}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══ PORTFOLIO TAB ══ */}
          {activeTab === "portfolio" && (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {portfolio.length === 0 ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: "var(--muted-foreground)" }}>
                  <div style={{ fontSize: 48 }}>▦</div>
                  <p style={{ fontSize: 18, fontWeight: 500 }}>No applications scored yet</p>
                  <p style={{ fontSize: 14 }}>Score applications and add them here to build your portfolio view</p>
                  <button onClick={() => setActiveTab("score")}
                    style={{ marginTop: 8, padding: "11px 22px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Score First Application →
                  </button>
                </div>
              ) : (
                <PortfolioTable
                  portfolio={portfolio}
                  weights={weights}
                  onView={(entry) => {
                    setApp({ name: entry.name, owner: entry.owner, tier: entry.tier, workloadCategory: entry.workloadCategory, currentPlatform: entry.currentPlatform ?? "Unknown / Not specified", description: entry.description, scores: entry.scores });
                    setResult(entry.result);
                    setViewedFromPortfolio(true);
                    setActiveTab("result");
                  }}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

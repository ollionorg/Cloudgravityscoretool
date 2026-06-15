import { useState, useEffect } from "react";
import { HomePage } from "./components/HomePage";
import { GravityScoreTool } from "./components/GravityScoreTool";

type Weights = { businessValue: number; cloudReadiness: number; complexity: number; dependencies: number };

interface ImportRowBase {
  name: string; owner: string; tier: string; workloadCategory: string; description: string;
  scores: { businessValue: number; cloudReadiness: number; complexity: number; dependencies: number };
  valid: boolean; errors: string[];
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota exceeded */ }
}

export default function App() {
  const [launched, setLaunched] = useState<boolean>(() => load("cgf_launched", false));
  const [launchWeights, setLaunchWeights] = useState<Weights | undefined>(() => load("cgf_weights", undefined));
  const [launchRows, setLaunchRows] = useState<ImportRowBase[] | undefined>(() => load("cgf_importRows", undefined));
  const [launchFileName, setLaunchFileName] = useState<string | null>(() => load("cgf_importFileName", null));

  useEffect(() => { save("cgf_launched", launched); }, [launched]);
  useEffect(() => { save("cgf_weights", launchWeights); }, [launchWeights]);
  useEffect(() => { save("cgf_importRows", launchRows); }, [launchRows]);
  useEffect(() => { save("cgf_importFileName", launchFileName); }, [launchFileName]);

  if (!launched) {
    return (
      <HomePage
        onLaunch={(weights, rows, fileName) => {
          setLaunchWeights(weights);
          setLaunchRows(rows ?? undefined);
          setLaunchFileName(fileName);
          setLaunched(true);
        }}
      />
    );
  }

  return (
    <GravityScoreTool
      initialWeights={launchWeights}
      initialImportRows={launchRows as any}
      initialImportFileName={launchFileName}
      onHome={() => setLaunched(false)}
    />
  );
}

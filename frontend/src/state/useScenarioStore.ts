import { useState } from "react";

export function useScenarioStore() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("normal");
  return { selectedScenarioId, setSelectedScenarioId };
}


"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type ResearchType = "company" | "person" | "product";

export interface PendingResearch {
  subject: string;
  type: ResearchType;
  startedAt: number;
}

interface ResearchContextValue {
  pending: PendingResearch | null;
  startResearch: (subject: string, type: ResearchType) => void;
  completeResearch: () => void;
  cancelResearch: () => void;
}

const ResearchContext = createContext<ResearchContextValue>({
  pending: null,
  startResearch: () => {},
  completeResearch: () => {},
  cancelResearch: () => {},
});

export function ResearchProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingResearch | null>(null);

  const startResearch = useCallback((subject: string, type: ResearchType) => {
    setPending({ subject, type, startedAt: Date.now() });
  }, []);

  const completeResearch = useCallback(() => {
    setPending(null);
  }, []);

  const cancelResearch = useCallback(() => {
    setPending(null);
  }, []);

  return (
    <ResearchContext.Provider value={{ pending, startResearch, completeResearch, cancelResearch }}>
      {children}
    </ResearchContext.Provider>
  );
}

export function useResearch() {
  return useContext(ResearchContext);
}

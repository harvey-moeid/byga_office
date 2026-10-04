import React, { Component, lazy } from "react";
export const OfficeScene = lazy(() => import("./scene"));
export const roles: Record<string, string> = {
  trend: "Trend Analyst",
  structure: "Structure Analyst",
  momentum: "Momentum Analyst",
  liquidity: "Liquidity Analyst",
  volume: "Volume Analyst",
  quant: "Quant Analyst",
  risk: "Risk Manager",
  boss: "Head Trader",
};
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${value === "BUY" || value === "OK" || value === "CLOSED" ? "positive" : value === "SELL" || value === "DOWN" || value === "FAILED" ? "negative" : ""}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Notice({
  error,
  retry,
}: {
  error?: string;
  retry?: () => void;
}) {
  return error ? (
    <div role="alert" className="notice">
      {error}
      {retry && <button onClick={retry}>Coba lagi</button>}
    </div>
  ) : null;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export class SceneBoundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Empty>3D tidak tersedia. Dashboard operasi tetap dapat digunakan.</Empty>
    ) : (
      this.props.children
    );
  }
}
export function supportsWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

"use client";
import { Component, ReactNode } from "react";
import styles from "./ErrorBoundary.module.css";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error?: string; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.error}>
          <div className={styles.icon}>⚠</div>
          <div className={styles.title}>Report rendering error</div>
          <div className={styles.message}>{this.state.error}</div>
          <button
            className={styles.retry}
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

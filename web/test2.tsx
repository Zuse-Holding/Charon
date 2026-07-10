const STEPS = ["a", "b"];
const styles: any = {};
export function Foo() {
  return (
    <div className={styles.steps}>
      {STEPS.map((step, i) => (
        <div
          key={i}
          className={styles.step}
          // Two animations on this element (see fade-in / step-cycle in
          // the CSS module) — the delay list lines up 1:1 with them:
          // fade-in staggers the initial reveal, step-cycle staggers the
          // ongoing breathing loop so steps don't all pulse in lockstep.
          style={{ animationDelay: `${i * 0.4}s, ${i * 0.35}s` }}
        >
          <span className={styles.stepDot} />
          <span className={styles.stepText}>{step}</span>
        </div>
      ))}
    </div>
  );
}

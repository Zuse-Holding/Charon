import styles from "./EntityTag.module.css";

type Type = "company" | "person" | "product";

export default function EntityTag({ type }: { type: Type }) {
  return (
    <span className={`${styles.tag} ${styles[type]}`}>
      {type.toUpperCase()}
    </span>
  );
}

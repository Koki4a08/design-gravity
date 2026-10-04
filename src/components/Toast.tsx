import { useEffect } from "react";
import { X } from "lucide-react";
import { useStudio } from "../lib/studio";

export function Toast() {
  const { error, clearError } = useStudio();
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 9000);
    return () => clearTimeout(t);
  }, [error, clearError]);
  if (!error) return null;
  return (
    <div className="toast" role="alert">
      <p>{error}</p>
      <button className="icon-btn" onClick={clearError} aria-label="Dismiss">
        <X aria-hidden />
      </button>
    </div>
  );
}

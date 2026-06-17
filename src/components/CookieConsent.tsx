/**
 * Cookie consent banner — GDPR/UA compliance.
 * Shows on first visit, stores consent in localStorage.
 * Only technically necessary cookies are used (session, language),
 * so consent is informational but legally required.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

const CONSENT_KEY = "marq.cookie_consent";
const CONSENT_VERSION = "1";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      if (stored !== CONSENT_VERSION) {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable — show banner
      setVisible(true);
    }
  }, []);

  const accept = () => {
    try {
      localStorage.setItem(CONSENT_KEY, CONSENT_VERSION);
    } catch {
      // ignore
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl text-sm text-muted-foreground">
          <p>
            Ми використовуємо технічно необхідні cookies для роботи сервісу (сесія, мова).
            Жодних рекламних або трекінгових cookies.{" "}
            <Link to="/privacy" className="text-primary hover:underline">
              Політика конфіденційності
            </Link>
          </p>
        </div>
        <Button size="sm" onClick={accept} className="shrink-0">
          Зрозуміло
        </Button>
      </div>
    </div>
  );
}

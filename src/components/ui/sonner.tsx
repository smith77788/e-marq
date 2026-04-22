import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Global toaster.
 *
 * a11y notes:
 *  - Sonner already wraps each toast with `role="status"` (polite) and
 *    `role="alert"` for `toast.error` (assertive), so screen readers announce
 *    new notifications without us doing anything extra.
 *  - We enable `closeButton` so keyboard-only users can dismiss toasts; the
 *    button is focusable via Tab.
 *  - `visibleToasts={5}` keeps the stack manageable instead of letting it grow.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      closeButton
      visibleToasts={5}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "group-[.toast]:bg-background group-[.toast]:text-muted-foreground group-[.toast]:border-border hover:group-[.toast]:bg-muted",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

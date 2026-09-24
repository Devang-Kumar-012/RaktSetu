"use client";

/**
 * Last-resort error boundary: catches a throw in the ROOT layout itself, which
 * src/app/error.tsx cannot cover because that boundary lives INSIDE the root
 * layout and would be unmounted by the same failure.
 *
 * It therefore cannot rely on any project component — if the root layout threw,
 * the providers, fonts and design system may all be unavailable. So it renders
 * self-contained HTML with inline styles rather than importing Button/Card, and
 * deliberately contains no links: with the layout gone, there is no navigation
 * to fall back to, and a dead <a> would be worse than none.
 *
 * As with error.tsx, no error message or stack is ever shown to the user.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#faf9f7",
          color: "#1c1917",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "32rem", textAlign: "center" }}>
          <p
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#b91c1c",
              margin: 0,
            }}
          >
            Something went wrong
          </p>
          <h1
            style={{
              fontSize: "1.875rem",
              fontWeight: 800,
              lineHeight: 1.2,
              margin: "0.5rem 0 0",
            }}
          >
            RaktSetu couldn&apos;t start this page
          </h1>
          <p style={{ fontSize: "1rem", lineHeight: 1.6, color: "#57534e" }}>
            Please try again. If it keeps happening, reload the page or contact
            us — nothing you submitted has been lost.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.75rem 1.5rem",
              minHeight: "2.75rem",
              borderRadius: "0.375rem",
              border: "none",
              backgroundColor: "#b91c1c",
              color: "#ffffff",
              fontSize: "1rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

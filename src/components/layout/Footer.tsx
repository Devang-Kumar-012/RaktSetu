import Link from "next/link";

import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

const columns = [
  {
    heading: "Take action",
    links: [
      { href: "/request-blood", label: "Request blood" },
      { href: "/donor", label: "Become a donor" },
    ],
  },
  {
    heading: "Learn more",
    links: [
      { href: "/about", label: "About RaktSetu" },
      { href: "/contact", label: "Contact & help" },
    ],
  },
  {
    heading: "Your account",
    links: [
      { href: "/login", label: "Log in" },
      { href: "/register", label: "Create account" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-ink-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div>
            <p className="text-2xl font-extrabold tracking-tight">
              Rakt<span className="text-blood-700">Setu</span>
            </p>
            <p className="mt-3 max-w-xs text-base text-ink-600">{APP_TAGLINE}</p>
          </div>
          {columns.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                {col.heading}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-base font-medium text-ink-800 hover:text-blood-700"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 border-t border-ink-100 pt-6">
          <p className="text-sm text-ink-400">
            © {new Date().getFullYear()} {APP_NAME}. RaktSetu supports the logistics of
            connecting donors and requesters. Medical eligibility and final donor screening
            always remain with authorized blood banks and medical professionals.
          </p>
        </div>
      </div>
    </footer>
  );
}

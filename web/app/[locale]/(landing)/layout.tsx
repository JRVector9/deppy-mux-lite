import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";

// SEO landing pages (category + agent + Ghostty), localized, intentionally out
// of the main nav and docs sidebar.
export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="w-full max-w-3xl mx-auto px-6 py-12">
        <div className="docs-content text-[15px]">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

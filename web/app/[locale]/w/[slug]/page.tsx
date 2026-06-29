import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isStackConfigured } from "../../../lib/stack";
import { getPublicWebAccessSession } from "@/services/mobile-web-access/sessions";
import { WebAccessSessionClient } from "./web-access-session-client";

type WebAccessPageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export async function generateMetadata({
  params,
}: WebAccessPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "webAccess" });

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function WebAccessPage({ params }: WebAccessPageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "webAccess" });
  const pwaT = await getTranslations({ locale, namespace: "pwa" });
  const session = await getPublicWebAccessSession(slug);
  const pagePath = locale === "en" ? `/w/${slug}` : `/${locale}/w/${slug}`;
  const signInHref = `/handler/sign-in?after_auth_return_to=${encodeURIComponent(pagePath)}`;

  if (!session) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-5 py-10">
        <div className="border-b border-border pb-5">
          <p className="mb-3 font-mono text-xs uppercase tracking-normal text-muted">
            {t("badge")}
          </p>
          <h1 className="text-3xl font-semibold tracking-normal">{t("title")}</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{t("subtitle")}</p>
        </div>
        <div className="grid gap-3 py-5 text-sm">
          <div className="rounded border border-border bg-code-bg p-3">
            <div className="text-xs text-muted">{t("session")}</div>
            <div className="mt-1 font-mono">{slug}</div>
          </div>
        </div>
        <WebAccessSessionClient
          copy={{
            clear: pwaT("clear"),
            composerPlaceholder: pwaT("composerPlaceholder"),
            connected: pwaT("connected"),
            enter: pwaT("enter"),
            selected: pwaT("selected"),
            send: pwaT("send"),
            signIn: pwaT("signIn"),
            signInRequired: pwaT("signInRequired"),
            status: t("status"),
            terminal: pwaT("terminal"),
            transcriptEmpty: pwaT("transcriptEmpty"),
            waiting: t("waiting"),
            workspaceList: pwaT("workspaceList"),
          }}
          authEnabled={isStackConfigured()}
          initialConnected={session.connected}
          signInHref={signInHref}
          slug={slug}
        />
      </section>
    </main>
  );
}

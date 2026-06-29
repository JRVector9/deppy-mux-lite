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
      <section className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-3 py-3 sm:px-5 sm:py-6 lg:py-8">
        <div className="border-b border-border pb-3 sm:pb-5">
          <p className="mb-3 font-mono text-xs uppercase tracking-normal text-muted">
            {t("badge")}
          </p>
          <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
            {t("title")}
          </h1>
          <p className="mt-2 hidden max-w-3xl text-sm leading-6 text-muted sm:block">
            {t("subtitle")}
          </p>
        </div>
        <div className="grid gap-3 py-3 text-sm sm:py-5">
          <div className="rounded border border-border bg-code-bg p-3 sm:max-w-xl">
            <div className="text-xs text-muted">{t("session")}</div>
            <div className="mt-1 truncate font-mono">{slug}</div>
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

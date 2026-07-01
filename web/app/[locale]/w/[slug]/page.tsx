import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getPublicWebAccessSession } from "@/services/mobile-web-access/sessions";
import { webAccessSessionRepository } from "@/services/mobile-web-access/local";
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
  const session = await getPublicWebAccessSession(slug, new Date(), webAccessSessionRepository());
  const pagePath = locale === "en" ? `/w/${slug}` : `/${locale}/w/${slug}`;
  const signInHref = `/handler/sign-in?after_auth_return_to=${encodeURIComponent(pagePath)}`;

  if (!session) {
    notFound();
  }

  return (
    <WebAccessSessionClient
      copy={{
        attachmentTooLarge: pwaT("attachmentTooLarge"),
        appVersion: pwaT("appVersion"),
        clear: pwaT("clear"),
        composerPlaceholder: pwaT("composerPlaceholder"),
        connected: pwaT("connected"),
        enter: pwaT("enter"),
        fitWidth: pwaT("fitWidth"),
        fontLarger: pwaT("fontLarger"),
        fontSmaller: pwaT("fontSmaller"),
        menu: pwaT("menu"),
        refreshSession: pwaT("refreshSession"),
        refreshSessionFailed: pwaT("refreshSessionFailed"),
        refreshingSession: pwaT("refreshingSession"),
        readableWrap: pwaT("readableWrap"),
        reconnecting: pwaT("reconnecting"),
        savedMacList: pwaT("savedMacList"),
        sendFailed: pwaT("sendFailed"),
        sessionExtended: pwaT("sessionExtended"),
        selected: pwaT("selected"),
        send: pwaT("send"),
        signIn: pwaT("signIn"),
        signInRequired: pwaT("signInRequired"),
        status: t("status"),
        terminal: pwaT("terminal"),
        title: pwaT("title"),
        transcriptEmpty: pwaT("transcriptEmpty"),
        waiting: t("waiting"),
        workspaceList: pwaT("workspaceList"),
        workspaceUpdated: pwaT("workspaceUpdated"),
        workspaceUpdatedBadge: pwaT("workspaceUpdatedBadge"),
        commandSection: pwaT("commandSection"),
        modelCommand: pwaT("modelCommand"),
        modelSection: pwaT("modelSection"),
        skillPickerTitle: pwaT("skillPickerTitle"),
      }}
      authEnabled={false}
      expiresAt={session.expiresAt}
      initialConnected={session.connected}
      signInHref={signInHref}
      slug={slug}
    />
  );
}

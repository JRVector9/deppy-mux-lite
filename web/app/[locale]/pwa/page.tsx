import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isStackConfigured } from "../../lib/stack";
import { MobilePwaClient } from "./mobile-pwa-client";

type PwaPageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: PwaPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pwa" });

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function PwaPage({ params }: PwaPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "pwa" });
  const pwaPath = locale === "en" ? "/pwa" : `/${locale}/pwa`;
  const signInHref = `/handler/sign-in?after_auth_return_to=${encodeURIComponent(pwaPath)}`;

  return (
    <MobilePwaClient
      copy={{
        title: t("title"),
        subtitle: t("subtitle"),
        connected: t("connected"),
        loadingDevices: t("loadingDevices"),
        signInRequired: t("signInRequired"),
        registryUnavailable: t("registryUnavailable"),
        signIn: t("signIn"),
        retry: t("retry"),
        webAccessSessions: t("webAccessSessions"),
        open: t("open"),
        noWebAccessSessions: t("noWebAccessSessions"),
        expires: t("expires"),
      }}
      authEnabled={isStackConfigured()}
      signInHref={signInHref}
    />
  );
}

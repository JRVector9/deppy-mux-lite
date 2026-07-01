import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
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

  return (
    <MobilePwaClient
      copy={{
        title: t("title"),
        subtitle: t("subtitle"),
        connected: t("connected"),
        loadingDevices: t("loadingDevices"),
        open: t("open"),
        expires: t("expires"),
        pwaListSavedMacs: t("pwaListSavedMacs"),
        pwaListLocalOnlyBadge: t("pwaListLocalOnlyBadge"),
        pwaListLocalOnlyTitle: t("pwaListLocalOnlyTitle"),
        pwaListLocalOnlyBody: t("pwaListLocalOnlyBody"),
        pwaListPairingTitle: t("pwaListPairingTitle"),
        pwaListPairingBody: t("pwaListPairingBody"),
        pwaListForget: t("pwaListForget"),
        pwaListLastSeen: t("pwaListLastSeen"),
        pwaListThisOrigin: t("pwaListThisOrigin"),
        pwaListWaitingForMac: t("pwaListWaitingForMac"),
        pwaListExpired: t("pwaListExpired"),
        pwaListTailscaleTitle: t("pwaListTailscaleTitle"),
        pwaListTailscaleLoopbackBody: t("pwaListTailscaleLoopbackBody"),
        pwaListTailscaleHttpBody: t("pwaListTailscaleHttpBody"),
        pwaListTailscaleReadyBody: t("pwaListTailscaleReadyBody"),
        pwaListTailscaleOtherBody: t("pwaListTailscaleOtherBody"),
      }}
    />
  );
}

import { getTranslations } from "next-intl/server";

export default async function Home() {
  const t = await getTranslations("app");
  return <h1>{t("name")}</h1>;
}

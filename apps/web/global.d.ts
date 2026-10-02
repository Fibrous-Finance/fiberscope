import type messages from "./messages/en";

declare module "next-intl" {
	interface AppConfig {
		Locale: "en";
		Messages: typeof messages;
	}
}

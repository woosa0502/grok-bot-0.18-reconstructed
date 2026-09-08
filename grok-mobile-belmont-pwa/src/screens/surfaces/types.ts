import type { AppRoute, SurfaceId } from "../../navigation";
import type { Bot } from "../../types";

export interface SurfaceScreenProps {
  route: AppRoute;
  bots: Bot[];
  bot: Bot | null;
  back: () => void;
  home: () => void;
  open: (name: SurfaceId, route?: Omit<AppRoute, "name">) => void;
  openChat: (botId: string) => void;
  refreshBots: () => Promise<void> | void;
  /** Bumps whenever the desktop event stream reports activity; screens use it to refresh live data. */
  eventRevision?: number;
}

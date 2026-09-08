import type { SurfaceId } from "../../navigation";
import type { ComponentType } from "react";
import {
  HiddenChatsScreen, LongMessageSheet, MessageActionsSheet, MessageReportSheet,
  NewChatScreen, NotificationsAskScreen, SearchSheet, ThreadScreen,
  TierNoAccessScreen, WebNoAccessScreen,
} from "./AccessAndConversationSurfaces";
import {
  AddMemberScreen, AgentPickerSheet, AgentProfileScreen, BotModelScreen, BoxDesktopScreen,
  BoxHelpRoute, BoxScreen, ComputerHelpSheet, ComputerSwitcherSheet, EmojiPickerView,
} from "./AgentAndComputerSurfaces";
import {
  AutoReviewApprovalSheet, AutoReviewRuleScreen, AutoReviewRulesScreen,
  BotTemplateDetailsScreen, BotTemplateImportScreen, ConnectorSheet, FailuresScreen,
  PluginsScreen, PluginsYoursScreen, RoutineDetailScreen, RoutineInstructionScreen,
  SkillSheet,
} from "./AutomationAndExtensionSurfaces";
import {
  AccountSheet, AppStoreReviewFlowSheet, AppearanceScreen, AttachmentPreviewRoute,
  AutofillEntryScreen, AutofillScreen, DefaultModelScreen, FeedbackSheet,
  FilePreviewSheet, HapticsScreen, ImageViewerRoute, LanguageScreen,
  ShareTargetScreen, SubscriptionScreen, TimeZoneScreen, UsageScreen, UserFormSheet,
} from "./FileAndSettingsSurfaces";
import { FileSystemScreen, LocalFilePreviewScreen } from "./PersonalFileSystemSurfaces";
import type { SurfaceScreenProps } from "./types";

export const PRODUCT_SURFACE_COMPONENTS: Partial<Record<SurfaceId, ComponentType<SurfaceScreenProps>>> = {
  NotificationsAskScreen,
  TierNoAccessScreen,
  WebNoAccessScreen,
  NewChatScreen,
  ThreadScreen,
  HiddenChatsScreen,
  SearchSheet,
  MessageActionsSheet,
  LongMessageSheet,
  MessageReportSheet,
  AgentProfileScreen,
  AgentPickerSheet,
  AddMemberScreen,
  EmojiPickerView,
  BoxScreen,
  BoxDesktopScreen,
  ComputerSwitcherSheet,
  ComputerHelpSheet,
  BoxHelpRoute,
  RoutineDetailScreen,
  RoutineInstructionScreen,
  AutoReviewRulesScreen,
  AutoReviewRuleScreen,
  AutoReviewApprovalSheet,
  FailuresScreen,
  PluginsScreen,
  PluginsYoursScreen,
  SkillSheet,
  BotTemplateDetailsScreen,
  BotTemplateImportScreen,
  BotModelScreen,
  ConnectorSheet,
  UserFormSheet,
  AutofillScreen,
  AutofillEntryScreen,
  AttachmentPreviewRoute,
  FilePreviewSheet,
  ImageViewerRoute,
  ShareTargetScreen,
  AppearanceScreen,
  DefaultModelScreen,
  LanguageScreen,
  HapticsScreen,
  TimeZoneScreen,
  UsageScreen,
  SubscriptionScreen,
  AccountSheet,
  FeedbackSheet,
  AppStoreReviewFlowSheet,
  FileSystemScreen,
  LocalFilePreviewScreen,
};

export function ProductSurfaceRouter(props: SurfaceScreenProps) {
  const Component = PRODUCT_SURFACE_COMPONENTS[props.route.name];
  if (Component == null) return null;
  return <Component key={`${props.route.name}:${props.route.botId ?? ""}:${props.route.entryId ?? ""}`} {...props} />;
}

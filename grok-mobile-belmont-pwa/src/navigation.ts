export const APK_SURFACE_IDS = [
  "OnboardingScreen",
  "NotificationsAskScreen",
  "TierNoAccessScreen",
  "WebNoAccessScreen",
  "HomeScreen",
  "ChatScreen",
  "NewChatScreen",
  "ThreadScreen",
  "HiddenChatsScreen",
  "SearchSheet",
  "MessageActionsSheet",
  "LongMessageSheet",
  "MessageReportSheet",
  "NewAgentScreen",
  "AgentProfileScreen",
  "AgentPickerSheet",
  "AddMemberScreen",
  "EmojiPickerView",
  "AgentComputerScreen",
  "BoxScreen",
  "BoxDesktopScreen",
  "ComputerSwitcherSheet",
  "ComputerHelpSheet",
  "BoxHelpRoute",
  "RoutineDetailScreen",
  "RoutineInstructionScreen",
  "AutoReviewRulesScreen",
  "AutoReviewRuleScreen",
  "AutoReviewApprovalSheet",
  "FailuresScreen",
  "PluginsScreen",
  "PluginsYoursScreen",
  "SkillSheet",
  "BotTemplateDetailsScreen",
  "BotTemplateImportScreen",
  "ConnectorSheet",
  "UserFormSheet",
  "AutofillScreen",
  "AutofillEntryScreen",
  "AttachmentPreviewRoute",
  "FilePreviewSheet",
  "ImageViewerRoute",
  "ShareTargetScreen",
  "SettingsSheet",
  "AppearanceScreen",
  "DefaultModelScreen",
  "LanguageScreen",
  "HapticsScreen",
  "TimeZoneScreen",
  "UsageScreen",
  "SubscriptionScreen",
  "AccountSheet",
  "FeedbackSheet",
  "AppStoreReviewFlowSheet",
  "BotModelScreen",
] as const;

export const PERSONAL_SURFACE_IDS = [
  "FileSystemScreen",
  "LocalFilePreviewScreen",
  "WindowsDesktopScreen",
] as const;

export const APP_SURFACE_IDS = [...APK_SURFACE_IDS, ...PERSONAL_SURFACE_IDS] as const;

export type SurfaceId = typeof APP_SURFACE_IDS[number];

export interface AppRoute {
  name: SurfaceId;
  botId?: string;
  entryId?: string;
  value?: string;
  attachment?: import("./types").AttachmentRef;
}

export const PRIMARY_SURFACES = new Set<SurfaceId>([
  "OnboardingScreen",
  "HomeScreen",
  "ChatScreen",
  "NewAgentScreen",
  "AgentComputerScreen",
  "WindowsDesktopScreen",
  "SettingsSheet",
]);

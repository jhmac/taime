import type { WorkLocation, ActivityLog, HolidayPayRule } from '@shared/schema';
import type { UseMutationResult } from '@tanstack/react-query';

export interface SettingsFormData {
  [key: string]: any;
}

export interface SettingsSectionProps {
  settingsForm: SettingsFormData;
  updateForm: (field: string, value: any) => void;
}

export interface BasicInfoSectionProps extends SettingsSectionProps {
  locations: WorkLocation[];
  showAddLocation: boolean;
  setShowAddLocation: (show: boolean) => void;
  editingLocation: WorkLocation | null;
  setEditingLocation: (loc: WorkLocation | null) => void;
  addLocationMutation: UseMutationResult<any, Error, any>;
  updateLocationMutation: UseMutationResult<any, Error, any>;
  deleteLocationMutation: UseMutationResult<any, Error, any>;
  handleAddLocation: (e: React.FormEvent<HTMLFormElement>) => void;
  handleUpdateLocation: (e: React.FormEvent<HTMLFormElement>) => void;
}

export interface PosConnectionSectionProps {
  shopifyDomain: string;
  setShopifyDomain: (domain: string) => void;
  connectedShop: any;
  connectShopifyMutation: UseMutationResult<any, Error, any>;
  disconnectShopifyMutation: UseMutationResult<any, Error, any>;
  syncSalesMutation: UseMutationResult<any, Error, any>;
  salesData: any;
}

export interface OvertimeSectionProps extends SettingsSectionProps {
  holidayPayRules: HolidayPayRule[];
  holidayInstruction: string;
  setHolidayInstruction: (val: string) => void;
  parseHolidayPayMutation: UseMutationResult<any, Error, any>;
  deleteHolidayRuleMutation: UseMutationResult<any, Error, any>;
  holidayAiSummary: string;
}

export interface ManagerLogSectionProps {
  activityLogs: ActivityLog[];
  formatLogAction: (log: ActivityLog) => string;
  formatLogTime: (date: Date | string | null) => string;
}

export interface ProfileSectionProps {
  user: any;
}

/**
 * Ant Design 5.x Theme Configuration
 * Maps design tokens to Ant Design's ConfigProvider theme prop.
 *
 * Usage in App.tsx:
 *   import { antTheme } from './styles/antTheme';
 *   <ConfigProvider theme={antTheme} locale={enUS}>
 */

import type { ThemeConfig } from 'antd';
import { colors, radius, fontFamily } from './tokens';

export const antTheme: ThemeConfig = {
  token: {
    // Primary
    colorPrimary: colors.primary,
    colorPrimaryHover: colors.primaryHover,
    colorPrimaryActive: colors.primaryDeep,

    // Success / Warning / Error
    colorSuccess: colors.success,
    colorWarning: colors.warning,
    colorError: colors.error,

    // Text
    colorText: colors.neutral800,
    colorTextSecondary: colors.neutral700,
    colorTextTertiary: colors.neutral600,
    colorTextQuaternary: colors.neutral600,

    // Backgrounds
    colorBgContainer: colors.surface,
    colorBgElevated: colors.surface,
    colorBgLayout: colors.neutral100,
    colorBgSpotlight: colors.neutral50,

    // Borders
    colorBorder: colors.neutral400,
    colorBorderSecondary: colors.neutral200,

    // Border radius
    borderRadius: radius.md,
    borderRadiusLG: radius.lg,
    borderRadiusSM: radius.sm,
    borderRadiusXS: radius.xs,

    // Typography
    fontFamily: fontFamily.system,
    fontFamilyCode: fontFamily.mono,
    fontSize: 14,
    fontSizeHeading1: 24,
    fontSizeHeading2: 20,
    fontSizeHeading3: 16,
    fontSizeHeading4: 14,
    fontSizeHeading5: 12,
    lineHeight: 1.5714,

    // Motion
    motionDurationFast: '0.1s',
    motionDurationMid: '0.2s',
    motionDurationSlow: '0.3s',
  },
  components: {
    Button: {
      borderRadius: radius.md,
      controlHeight: 32,
      paddingInline: 16,
    },
    Card: {
      borderRadiusLG: radius.lg,
    },
    Input: {
      borderRadius: radius.md,
    },
    Select: {
      borderRadius: radius.md,
    },
    Table: {
      headerBg: colors.neutral200,
      rowHoverBg: colors.neutral50,
    },
    Tag: {
      borderRadiusSM: radius.xl,
    },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
    },
  },
};

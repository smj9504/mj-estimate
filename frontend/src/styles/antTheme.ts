/**
 * Ant Design 5.x Theme Configuration
 * Maps design tokens to Ant Design's ConfigProvider theme prop.
 *
 * Usage in App.tsx:
 *   import { antTheme } from './styles/antTheme';
 *   <ConfigProvider theme={antTheme} locale={enUS}>
 */

import type { ThemeConfig } from 'antd';
import { colors, radius, fontFamily, tagTones } from './tokens';

// Translucent ink, used for hover and selection fills so they read the same
// on white and on the sidebar's warm grey.
const inkHover = 'rgba(55, 53, 47, 0.06)';
const inkSelected = 'rgba(55, 53, 47, 0.08)';

export const antTheme: ThemeConfig = {
  token: {
    // Primary
    colorPrimary: colors.primary,
    colorPrimaryHover: colors.primaryHover,
    colorPrimaryActive: colors.primaryDeep,
    colorLink: colors.primary,
    colorLinkHover: colors.primaryHover,
    colorInfo: colors.primary,

    // Success / Warning / Error
    colorSuccess: colors.success,
    colorWarning: colors.warning,
    colorError: colors.error,

    // Text
    colorText: colors.neutral900,
    colorTextHeading: colors.neutral900,
    colorTextSecondary: colors.neutral700,
    colorTextTertiary: colors.neutral600,
    colorTextQuaternary: colors.neutral600,
    colorTextDescription: colors.neutral600,
    // 4.75:1 on white; values stay ink so the two remain distinct
    colorTextPlaceholder: colors.neutral600,

    // Backgrounds
    colorBgContainer: colors.surface,
    colorBgElevated: colors.surface,
    colorBgLayout: colors.surface,
    // Tooltip background only (AntD-reserved token) — Ink, so the tooltip's
    // white text stays legible. Do not set this to a light neutral.
    colorBgSpotlight: colors.neutral900,
    colorFillAlter: colors.neutral50,
    colorFillSecondary: colors.neutral100,
    colorFillTertiary: inkHover,
    colorFillQuaternary: 'rgba(55, 53, 47, 0.03)',

    // Borders
    colorBorder: colors.neutral400,
    colorBorderSecondary: colors.neutral200,
    colorSplit: colors.neutral200,

    // Border radius
    borderRadius: radius.md,
    borderRadiusLG: radius.lg,
    borderRadiusSM: radius.sm,
    borderRadiusXS: radius.xs,

    // Elevation: flat surfaces, soft layered shadow only for floating layers
    boxShadow: 'rgba(15, 15, 15, 0.05) 0 0 0 1px, rgba(15, 15, 15, 0.1) 0 3px 6px, rgba(15, 15, 15, 0.2) 0 9px 24px',
    boxShadowSecondary: 'rgba(15, 15, 15, 0.05) 0 0 0 1px, rgba(15, 15, 15, 0.1) 0 3px 6px, rgba(15, 15, 15, 0.2) 0 9px 24px',
    boxShadowTertiary: 'none',

    // Typography
    fontFamily: fontFamily.system,
    fontFamilyCode: fontFamily.mono,
    fontSize: 14,
    fontSizeHeading1: 30,
    fontSizeHeading2: 24,
    fontSizeHeading3: 20,
    fontSizeHeading4: 16,
    fontSizeHeading5: 14,
    fontWeightStrong: 600,
    lineHeight: 1.5,

    // Controls
    controlHeight: 32,
    controlOutline: 'rgba(31, 116, 201, 0.18)',
    controlOutlineWidth: 2,
    controlItemBgHover: inkHover,
    controlItemBgActive: inkSelected,
    controlItemBgActiveHover: inkSelected,

    // Motion
    motionDurationFast: '0.1s',
    motionDurationMid: '0.15s',
    motionDurationSlow: '0.2s',
  },
  components: {
    Layout: {
      bodyBg: colors.surface,
      headerBg: colors.surface,
      headerHeight: 52,
      headerPadding: '0 16px',
      siderBg: colors.neutral50,
      lightSiderBg: colors.neutral50,
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemColor: colors.neutral700,
      itemHoverColor: colors.neutral900,
      itemHoverBg: inkHover,
      itemSelectedBg: inkSelected,
      itemSelectedColor: colors.neutral900,
      itemActiveBg: inkSelected,
      groupTitleColor: colors.neutral600,
      itemHeight: 30,
      itemMarginBlock: 1,
      itemMarginInline: 8,
      itemBorderRadius: radius.md,
      iconSize: 15,
      collapsedIconSize: 16,
      activeBarBorderWidth: 0,
      subMenuItemBorderRadius: radius.md,
    },
    Button: {
      borderRadius: radius.md,
      controlHeight: 32,
      paddingInline: 12,
      fontWeight: 500,
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
      defaultBorderColor: colors.neutral400,
      defaultColor: colors.neutral900,
      defaultHoverBg: colors.neutral50,
      defaultHoverColor: colors.neutral900,
      defaultHoverBorderColor: colors.neutral400,
      textHoverBg: inkHover,
    },
    Card: {
      borderRadiusLG: radius.lg,
      headerFontSize: 15,
      headerHeight: 48,
      headerHeightSM: 40,
      boxShadowTertiary: 'none',
    },
    Input: {
      borderRadius: radius.md,
      activeShadow: '0 0 0 2px rgba(31, 116, 201, 0.18)',
      hoverBorderColor: '#c8c7c3',
    },
    InputNumber: {
      activeShadow: '0 0 0 2px rgba(31, 116, 201, 0.18)',
      hoverBorderColor: '#c8c7c3',
    },
    Select: {
      borderRadius: radius.md,
      optionSelectedBg: inkSelected,
      optionActiveBg: inkHover,
      optionSelectedFontWeight: 500,
      hoverBorderColor: '#c8c7c3',
    },
    DatePicker: {
      activeShadow: '0 0 0 2px rgba(31, 116, 201, 0.18)',
      hoverBorderColor: '#c8c7c3',
    },
    Table: {
      headerBg: colors.surface,
      headerColor: colors.neutral600,
      headerSplitColor: 'transparent',
      headerSortActiveBg: colors.neutral50,
      headerSortHoverBg: colors.neutral50,
      rowHoverBg: 'rgba(55, 53, 47, 0.03)',
      rowSelectedBg: '#eef5fc',
      rowSelectedHoverBg: '#e5f0fb',
      borderColor: colors.neutral200,
      footerBg: colors.surface,
      cellPaddingBlock: 10,
      cellPaddingInline: 12,
      cellPaddingBlockSM: 6,
      cellPaddingInlineSM: 8,
    },
    Tag: {
      borderRadiusSM: radius.sm,
      defaultBg: tagTones.gray.bg,
      defaultColor: tagTones.gray.text,
    },
    Tabs: {
      itemColor: colors.neutral600,
      itemHoverColor: colors.neutral900,
      itemSelectedColor: colors.neutral900,
      inkBarColor: colors.neutral900,
      titleFontSize: 14,
      horizontalItemPadding: '10px 0',
      horizontalItemGutter: 20,
      horizontalMargin: '0 0 16px 0',
    },
    Descriptions: {
      labelBg: colors.surface,
      labelColor: colors.neutral600,
      titleColor: colors.neutral900,
      titleMarginBottom: 8,
      itemPaddingBottom: 8,
    },
    Breadcrumb: {
      itemColor: colors.neutral600,
      lastItemColor: colors.neutral900,
      linkColor: colors.neutral600,
      linkHoverColor: colors.neutral900,
      separatorColor: '#c8c7c3',
      fontSize: 13,
    },
    Collapse: {
      headerBg: colors.surface,
      contentBg: colors.surface,
    },
    Modal: {
      borderRadiusLG: radius.xl,
      titleFontSize: 16,
    },
    Drawer: {
      borderRadiusLG: radius.xl,
    },
    Segmented: {
      itemSelectedBg: colors.surface,
      trackBg: colors.neutral100,
    },
    Switch: {
      colorPrimary: colors.primary,
      colorPrimaryHover: colors.primaryHover,
    },
    Statistic: {
      titleFontSize: 13,
      contentFontSize: 22,
    },
    Steps: {
      iconSize: 24,
      dotSize: 8,
    },
    Badge: {
      dotSize: 6,
    },
    Divider: {
      colorSplit: colors.neutral200,
    },
  },
};

/**
 * One step up from the base scale (15px text, 36px controls) for pages that
 * are read on a phone in the field, such as the claim follow-up page. Wrap the
 * page in a nested ConfigProvider; everything else inherits from antTheme.
 */
export const comfortTheme: ThemeConfig = {
  token: {
    fontSize: 15,
    fontSizeSM: 13,
    controlHeight: 36,
    controlHeightSM: 28,
  },
  components: {
    Button: {
      controlHeight: 36,
      paddingInline: 14,
    },
    Tabs: {
      titleFontSize: 15,
      horizontalItemPadding: '12px 0',
      horizontalItemGutter: 24,
    },
    Modal: {
      titleFontSize: 17,
    },
    Dropdown: {
      paddingBlock: 7,
    },
  },
};

/**
 * FollowUpDateTimePicker — the date-and-time field the follow-up forms share.
 *
 * antd's date-time popup puts presets, the calendar and three time columns in
 * one row, about 640px wide, which runs off a phone. Here the time drops its
 * seconds column, and on phones the cells tighten and the presets move to a
 * row of chips above the calendar (`.fu-picker-popup` in notion.css), so the
 * popup fits a 360px screen. Phones also skip the keyboard: the field opens
 * the picker only.
 */

import React from 'react';
import { ConfigProvider, DatePicker, Grid } from 'antd';
import type { DatePickerProps, ThemeConfig } from 'antd';

const PHONE_PICKER_THEME: ThemeConfig = {
  components: { DatePicker: { cellWidth: 32, timeColumnWidth: 48 } },
};

const FollowUpDateTimePicker: React.FC<DatePickerProps> = (props) => {
  const screens = Grid.useBreakpoint();
  const isPhone = screens.md === false;
  const picker = (
    <DatePicker
      showTime={{ format: 'HH:mm' }}
      format="YYYY-MM-DD HH:mm"
      inputReadOnly={isPhone}
      style={{ width: '100%' }}
      classNames={{ popup: { root: 'fu-picker-popup' } }}
      {...props}
    />
  );
  return isPhone ? <ConfigProvider theme={PHONE_PICKER_THEME}>{picker}</ConfigProvider> : picker;
};

export default FollowUpDateTimePicker;

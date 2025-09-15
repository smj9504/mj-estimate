/**
 * Admin Configuration Page
 * Main page for system configuration management
 */

import React from 'react';
import { ConfigManagementLayout } from '../components/admin/config';

const AdminConfig: React.FC = () => {
  return (
    <div style={{ padding: '24px' }}>
      <ConfigManagementLayout />
    </div>
  );
};

export default AdminConfig;
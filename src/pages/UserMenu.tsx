import React, { useState } from 'react';
import { Button, Menu, MenuItem, Typography } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

interface UserMenuProps {
  username: string;
  onLogout: () => void;
  onChangePassword: () => void;
}

const UserMenu: React.FC<UserMenuProps> = ({ username, onLogout, onChangePassword }) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <Button
        variant="text"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        endIcon={<KeyboardArrowDownIcon />}
        sx={{ textTransform: 'none' }}
      >
        {username}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        slotProps={{
          paper: { sx: { py: '4px', px: '8px' } }
        }}
        sx={{ '& .MuiMenuItem-root': { padding: '6px 16px' } }}
      >
        <MenuItem onClick={() => {
          setAnchorEl(null);
          onChangePassword();
        }}>
          <Typography sx={{ fontSize: 14 }}>Change Password</Typography>
        </MenuItem>
        <MenuItem onClick={() => {
          setAnchorEl(null);
          onLogout();
        }}>
          <Typography sx={{ fontSize: 14 }}>Logout</Typography>
        </MenuItem>
      </Menu>
    </>
  );
};

export default UserMenu;

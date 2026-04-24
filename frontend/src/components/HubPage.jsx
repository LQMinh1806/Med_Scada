import { memo, useCallback, useMemo } from 'react';
import { Box, Grid, Card, CardContent, Typography, alpha } from '@mui/material';
import {
  MonitorHeart,
  PrecisionManufacturing,
  AdminPanelSettings,
  Analytics,
} from '@mui/icons-material';
import { USER_ROLES } from '../constants';

const HUB_CARDS = [
  {
    title: 'Giám sát',
    page: 'monitoring',
    icon: <MonitorHeart />,
    desc: 'Giám sát cabin vận hành',
    bgColor: '#6aff65',
  },
  {
    title: 'Điều khiển',
    page: 'control',
    icon: <PrecisionManufacturing />,
    desc: 'Quản lý, quét mẫu & điều phối',
    bgColor: '#0b91df',
  },
  {
    title: 'Kỹ thuật',
    page: 'admin',
    icon: <AdminPanelSettings />,
    desc: 'Logs, phân quyền & dữ liệu',
    bgColor: '#ff0000',
  },
];

const HubCard = memo(function HubCard({ item, onNavigate }) {
  const handleClick = useCallback(() => onNavigate(item.page), [onNavigate, item.page]);

  return (
    <Grid item xs={12} sm={4} md={4} sx={{ display: 'flex', justifyContent: 'center' }}>
      <Card
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        tabIndex={0}
        role="button"
        aria-label={`Chuyển đến trang ${item.title}`}
        sx={{
          textAlign: 'center',
          cursor: 'pointer',
          width: '100%',
          maxWidth: 360,
          minHeight: { xs: 210, sm: 230, md: 250 },
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          overflow: 'hidden',
          transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            transform: 'translateY(-6px) scale(1.01)',
            boxShadow: `0 14px 34px ${alpha(item.bgColor, 0.28)}`,
            '& .hub-icon-box': {
              transform: 'scale(1.08)',
            },
          },
          '&:active': {
            transform: 'translateY(-3px)',
          },
          '&:focus-visible': {
            outline: `2px solid ${alpha(item.bgColor, 0.7)}`,
            outlineOffset: 2,
          },
        }}
      >

        <CardContent
          sx={{
            py: 4,
            px: 2.5,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            width: '100%',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <Box
            className="hub-icon-box"
            sx={{
              width: 64,
              height: 64,
              borderRadius: '14px',
              background: `linear-gradient(135deg, ${item.bgColor}, ${alpha(item.bgColor, 0.72)})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.35s ease',
              '& .MuiSvgIcon-root': {
                fontSize: 32,
                color: '#111',
              },
            }}
          >
            {item.icon}
          </Box>

          <Box>
            <Typography
              variant="h6"
              fontWeight={800}
              gutterBottom
              sx={{
                color: 'text.primary',
                letterSpacing: '-0.01em',
                fontSize: { xs: '1rem', md: '1.08rem' },
              }}
            >
              {item.title}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 500,
                lineHeight: 1.5,
                color: 'text.secondary',
                fontSize: { xs: '0.86rem', md: '0.9rem' },
              }}
            >
              {item.desc}
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Grid>
  );
});

const HubPage = memo(function HubPage({ navigateTo, currentUser }) {
  const visibleCards = useMemo(() => {
    return HUB_CARDS.filter(
      (item) => item.page !== 'admin' || currentUser?.role === USER_ROLES.TECH
    );
  }, [currentUser?.role]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '68vh',
        py: 2,
        px: 1,
      }}
    >
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography
          variant="h5"
          fontWeight={900}
          sx={{
            mb: 0.5,
            color: 'text.primary',
          }}
        >
          TRUNG TÂM ĐIỀU KHIỂN
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            fontWeight: 500,
          }}
        >
          Chọn chức năng để bắt đầu làm việc
        </Typography>
      </Box>

      <Grid
        container
        spacing={3}
        sx={{ width: '100%', maxWidth: 760 }}
        justifyContent="center"
        alignItems="stretch"
      >
        {visibleCards.map((item) => (
          <HubCard key={item.page + item.title} item={item} onNavigate={navigateTo} />
        ))}
      </Grid>
    </Box>
  );
});

export default HubPage;
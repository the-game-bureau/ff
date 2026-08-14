(function () {
  const projectRef = 'vkoczgzizzppdrpvpemh';
  const url = `https://${projectRef}.supabase.co`;
  const publishableKey = 'PASTE_NEW_PUBLISHABLE_KEY_HERE';

  window.FF_SUPABASE_CONFIG = Object.freeze({
    projectRef,
    url,
    publishableKey,
    // Leave this as the old key if you copy auth sessions and reuse the old
    // JWT secret. Change it to the new ref if you prefer to force a clean login.
    storageKey: 'law-order-svu-auth-qmaafbncpzrdmqapkkgr',
    resetRedirectUrl: 'https://thegamebureau.com/ff/',
    tables: Object.freeze({
      profiles: '_2026_profiles',
      picks: '_2026_picks',
      schedule: '_2026_nfl_schedule',
      archivePlayers: '_2026_archive_players',
    }),
    views: Object.freeze({
      activePicks: '_2026_active_picks',
      currentSuspects: '_2026_current_suspects',
    }),
    rpcs: Object.freeze({
      adminListProfiles: '_2026_admin_list_profiles',
      adminUpdateProfile: '_2026_admin_update_profile',
      adminListArchivePlayers: '_2026_admin_list_archive_players',
      adminListUsers: '_2026_admin_list_users',
      adminRemoveMember: '_2026_admin_remove_member',
    }),
    dashboard: Object.freeze({
      scheduleTableUrl: `https://supabase.com/dashboard/project/${projectRef}/editor/table/_2026_nfl_schedule?schema=public`,
    }),
  });
})();

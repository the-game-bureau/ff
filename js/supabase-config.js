(function () {
  const projectRef = 'vkoczgzizzppdrpvpemh';
  const url = `https://${projectRef}.supabase.co`;
  const publishableKey = 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';

  window.FF_SUPABASE_CONFIG = Object.freeze({
    projectRef,
    url,
    publishableKey,
    // New project uses its own JWT secret, so force a clean login instead of
    // replaying old cached sessions that PostgREST rejects.
    storageKey: `law-order-svu-auth-${projectRef}`,
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


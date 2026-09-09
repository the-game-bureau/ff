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
    // Every password field on the site reads this. The booking form used to ask
    // for 6 and the recovery lightbox for 8, so a member who joined with six
    // characters, forgot them, and followed the recovery link was told the rule
    // had changed, with nothing to say why. 8 is the stricter of the two, which
    // is also the safe direction: Supabase enforces its own minimum server
    // side, and a client that asks for more than the server does can never be
    // refused for asking too little.
    passwordMinLength: 8,
    tables: Object.freeze({
      profiles: '_2026_profiles',
      picks: '_2026_picks',
      schedule: '_2026_nfl_schedule',
      archivePlayers: '_2026_archive_players',
      adminTodos: '_2026_admin_todos',
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
      emailRegistered: '_2026_email_registered',
      adminSetSuspectColors: '_2026_admin_set_suspect_colors',
      // A suspect's own record, read and written by js/rap-sheet.js. Functions
      // rather than table access because last_name, sms and email are not
      // selectable by a browser role at all - see
      // supabase/sql/ff_own_rap_sheet.sql.
      myRapSheet: '_2026_my_rap_sheet',
      saveMyRapSheet: '_2026_save_my_rap_sheet',
    }),
    dashboard: Object.freeze({
      // The admin page's Database button. 17649 is the table's own id in
      // this project, so unlike everything else here it does not follow
      // projectRef - a new project would need a new number.
      databaseUrl: `https://supabase.com/dashboard/project/${projectRef}/editor/17649?schema=public`,
      scheduleTableUrl: `https://supabase.com/dashboard/project/${projectRef}/editor/table/_2026_nfl_schedule?schema=public`,
    }),
  });
})();


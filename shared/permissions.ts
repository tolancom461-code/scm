export const ATOMIC_PERMISSIONS = [
  {
    code: "pm.view",
    module: "projectManagement",
    action: "view",
    ar: "عرض وحدة المشاريع",
    en: "View project module",
    ur: "View project module",
  },

  {
    code: "pm.create",
    module: "projectManagement",
    action: "create",
    ar: "إنشاء مشروع وحفظ المسودة",
    en: "Create project drafts",
    ur: "Create project drafts",
  },

  {
    code: "pm.edit",
    module: "projectManagement",
    action: "edit",
    ar: "تعديل مسودات المشاريع",
    en: "Edit project drafts",
    ur: "Edit project drafts",
  },

  {
    code: "pm.submit",
    module: "projectManagement",
    action: "submit",
    ar: "إرسال المشروع للاعتماد",
    en: "Submit projects",
    ur: "Submit projects",
  },

  {
    code: "pm.review",
    module: "projectManagement",
    action: "review",
    ar: "مراجعة واعتماد المشاريع — الإدارة العليا",
    en: "Review and approve projects",
    ur: "Review and approve projects",
  },

  {
    code: "pm.start",
    module: "projectManagement",
    action: "start",
    ar: "بدء تنفيذ المشروع المعتمد",
    en: "Start approved projects",
    ur: "Start approved projects",
  },

  {
    code: "pm.tasks.manage",
    module: "projectManagement",
    action: "tasks_manage",
    ar: "إدارة مهام المشروع",
    en: "Manage project tasks",
    ur: "Manage project tasks",
  },

  {
    code: "pm.employees.manage",
    module: "projectManagement",
    action: "employees_manage",
    ar: "إدارة قائمة الموظفين",
    en: "Manage employee directory",
    ur: "Manage employee directory",
  },

  {
    code: "pm.statuses.manage",
    module: "projectManagement",
    action: "statuses_manage",
    ar: "تعديل حالات المهام وإضافة حالات",
    en: "Manage task statuses",
    ur: "Manage task statuses",
  },

  {
    code: "p1.inspections.view",

    module: "phaseOne",

    action: "inspections_view",

    ar: "ط¹ط±ط¶ ظپط­طµ ط§ظ„ط£ط¹ظ…ط§ظ„ FIR",

    en: "View work inspections FIR",

    ur: "ع©ط§ظ… ع©غ’ ظ…ط¹ط§ط¦ظ†غ’ ط¯غŒع©ع¾غŒع؛",
  },

  {
    code: "p1.inspections.manage",

    module: "phaseOne",

    action: "inspections_manage",

    ar: "ط¥ظ†ط´ط§ط، ظپط­طµ ط§ظ„ط£ط¹ظ…ط§ظ„ ظˆطھط¹ط¯ظٹظ„ ظ†طھظٹط¬طھظ‡",

    en: "Create work inspections and record results",

    ur: "ع©ط§ظ… ع©غ’ ظ…ط¹ط§ط¦ظ†غ’ ط¨ظ†ط§ط¦غŒع؛ ط§ظˆط± ظ†طھط§ط¦ط¬ ط¯ط±ط¬ ع©ط±غŒع؛",
  },

  {
    code: "p1.certificates.schedule",

    module: "phaseOne",

    action: "certificates_schedule",

    ar: "ط§ط¹طھظ…ط§ط¯ ط¬ط¯ظˆظ„ ط¯ظپط¹ط§طھ ط§ظ„ظ…ط³طھط®ظ„طµ ظˆطھط¹ط¯ظٹظ„ طھظˆط²ظٹط¹ ط§ظ„ط³ظ†ط¯ط§طھ",

    en: "Approve certificate installment schedules and voucher allocation",

    ur: "ظ…ط³طھط®ظ„طµ ع©غŒ ط§ظ‚ط³ط§ط· ع©ط§ ط´غŒعˆظˆظ„ ظ…ظ†ط¸ظˆط± ع©ط±غŒع؛",
  },

  {
    code: "p1.payments.reverse.approve",

    module: "phaseOne",

    action: "payments_reverse_approve",

    ar: "ط§ط¹طھظ…ط§ط¯ ط£ظˆ ط±ظپط¶ ط¹ظƒط³ ط³ط¬ظ„ ط§ظ„طµط±ظپ",

    en: "Approve or reject disbursement record reversals",

    ur: "ط§ط¯ط§ط¦غŒع¯غŒ ع©غŒ ظˆط§ظ¾ط³غŒ ظ…ظ†ط¸ظˆط± غŒط§ ظ…ط³طھط±ط¯ ع©ط±غŒع؛",
  },

  {
    code: "p1.contracts.handover",

    module: "phaseOne",

    action: "contracts_handover",

    ar: "ط§ط¹طھظ…ط§ط¯ ط§ظ„طھط³ظ„ظٹظ… ط§ظ„ظ†ظ‡ط§ط¦ظٹ ظˆط¨ط¯ط§ظٹط© ط§ظ„ط¶ظ…ط§ظ†",

    en: "Approve final handover and warranty commencement",

    ur: "ط¢ط®ط±غŒ ط­ظˆط§ظ„ع¯غŒ ط§ظˆط± ط¶ظ…ط§ظ†طھ ع©ط§ ط¢ط؛ط§ط² ظ…ظ†ط¸ظˆط± ع©ط±غŒع؛",
  },

  {
    code: "policy.view",

    module: "policy",

    action: "view",

    ar: "ط¹ط±ط¶ ظ…ط±ظƒط² ط§ظ„ط³ظٹط§ط³ط§طھ",

    en: "View policy center",

    ur: "ظ¾ط§ظ„غŒط³غŒ ظ…ط±ع©ط² ط¯غŒع©ع¾غŒع؛",
  },

  {
    code: "policy.manage",

    module: "policy",

    action: "manage",

    ar: "ط¥ط¯ط§ط±ط© ط§ظ„ط£ط¯ظˆط§ط± ظˆط§ظ„طµظ„ط§ط­ظٹط§طھ ظˆظ†ط·ط§ظ‚ ط§ظ„ظ…ط´ط§ط±ظٹط¹",

    en: "Manage roles, permissions and project scope",

    ur: "ع©ط±ط¯ط§ط±طŒ ط§ط¬ط§ط²طھغŒع؛ ط§ظˆط± ظ…ظ†طµظˆط¨ظˆع؛ ع©ط§ ط¯ط§ط¦ط±غپ ظ…ظ†ط¸ظ… ع©ط±غŒع؛",
  },

  {
    code: "p1.projects.view",

    module: "phaseOne",

    action: "projects_view",

    ar: "ط¹ط±ط¶ ظ…ط´ط§ط±ظٹط¹ ط§ظ„ظ…ط±ط­ظ„ط© ط§ظ„ط£ظˆظ„ظ‰",

    en: "View current projects",

    ur: "ظ…ظˆط¬ظˆط¯غپ ظ…ظ†طµظˆط¨غ’ ط¯غŒع©ع¾غŒع؛",
  },

  {
    code: "p1.projects.create",

    module: "phaseOne",

    action: "projects_create",

    ar: "ط¥ط¶ط§ظپط© ظ…ط´ط±ظˆط¹",

    en: "Create project",

    ur: "ظ…ظ†طµظˆط¨غپ ط¨ظ†ط§ط¦غŒع؛",
  },

  {
    code: "p1.company.view",

    module: "phaseOne",

    action: "company_view",

    ar: "ط¹ط±ط¶ طھظ‡ظٹط¦ط© ط§ظ„ط´ط±ظƒط©",

    en: "View company setup",

    ur: "ع©ظ…ظ¾ظ†غŒ ع©غŒ طھط±طھغŒط¨ط§طھ ط¯غŒع©ع¾غŒع؛",
  },

  {
    code: "p1.company.manage",

    module: "phaseOne",

    action: "company_manage",

    ar: "طھط¹ط¯ظٹظ„ طھظ‡ظٹط¦ط© ط§ظ„ط´ط±ظƒط©",

    en: "Edit company setup",

    ur: "ع©ظ…ظ¾ظ†غŒ ع©غŒ طھط±طھغŒط¨ط§طھ طھط¨ط¯غŒظ„ ع©ط±غŒع؛",
  },

  {
    code: "p1.contracts.view",

    module: "phaseOne",

    action: "contracts_view",

    ar: "ط¹ط±ط¶ ط§ظ„ط¹ظ‚ظˆط¯ ظˆظ‚ظٹظ…ظ‡ط§ ظˆط¬ط¯ظˆظ„ ط¯ظپط¹ط§طھظ‡ط§",

    en: "View contracts, values and schedules",

    ur: "ظ…ط¹ط§غپط¯غ’طŒ ط±ظ‚ظ… ط§ظˆط± ط´غŒعˆظˆظ„ ط¯غŒع©ع¾غŒع؛",
  },

  {
    code: "p1.contracts.create",

    module: "phaseOne",

    action: "contracts_create",

    ar: "ط¥ظ†ط´ط§ط، ط§ظ„ط¹ظ‚ظˆط¯ ظˆطھطµط­ظٹط­ ط´ط±ظˆط·ظ‡ط§ ط§ظ„ظˆطµظپظٹط© ظˆط¥ظ„ط؛ط§ط، ط؛ظٹط± ط§ظ„ظ…ط³طھط®ط¯ظ…",

    en: "Create contracts, correct descriptive terms and cancel unused contracts",

    ur: "ظ…ط¹ط§غپط¯غ’ ط¨ظ†ط§ط¦غŒع؛طŒ ط´ط±ط§ط¦ط· ط¯ط±ط³طھ ع©ط±غŒع؛ ط§ظˆط± ط؛غŒط± ط§ط³طھط¹ظ…ط§ظ„ ط´ط¯غپ ظ…ط¹ط§غپط¯غ’ ظ…ظ†ط³ظˆط® ع©ط±غŒع؛",
  },

  {
    code: "p1.certificates.view",

    module: "phaseOne",

    action: "certificates_view",

    ar: "ط¹ط±ط¶ ط§ظ„ظ…ط³طھط®ظ„طµط§طھ ظˆظ‚ظٹظ…ظ‡ط§",

    en: "View certificates and values",

    ur: "ظ…ط³طھط®ظ„طµ ط§ظˆط± ط±ظ‚ظ… ط¯غŒع©ع¾غŒع؛",
  },

  {
    code: "p1.certificates.create",

    module: "phaseOne",

    action: "certificates_create",

    ar: "ط¥ط¹ط¯ط§ط¯ ظ…ط³طھط®ظ„طµ ظ…ط±ط­ظ„ط© ط£ظˆظ„ظ‰",

    en: "Prepare current certificate",

    ur: "ظ…ظˆط¬ظˆط¯غپ ظ…ط³طھط®ظ„طµ طھغŒط§ط± ع©ط±غŒع؛",
  },

  {
    code: "p1.certificates.approve",

    module: "phaseOne",

    action: "certificates_approve",

    ar: "ط§ط¹طھظ…ط§ط¯ ط£ظˆ ط±ظپط¶ ط§ظ„ظ…ط³طھط®ظ„طµ",

    en: "Approve or reject certificate",

    ur: "ظ…ط³طھط®ظ„طµ ظ…ظ†ط¸ظˆط± غŒط§ ظ…ط³طھط±ط¯ ع©ط±غŒع؛",
  },

  {
    code: "p1.payments.view",

    module: "phaseOne",

    action: "payments_view",

    ar: "ط¹ط±ط¶ ط§ظ„ظ…طµط±ظˆظپ ظˆط§ظ„ط£ط±طµط¯ط© ظˆط§ظ„ط¯ظپط¹ط© ط§ظ„ظ‚ط§ط¯ظ…ط©",

    en: "View disbursements, balances and next installment",

    ur: "ط§ط¯ط§ط¦غŒع¯غŒطŒ ط¨ظ‚ط§غŒط§ ط§ظˆط± ط§ع¯ظ„غŒ ظ‚ط³ط· ط¯غŒع©ع¾غŒع؛",
  },

  {
    code: "p1.payments.record",

    module: "phaseOne",

    action: "payments_record",

    ar: "طھط³ط¬ظٹظ„ ط§ظ„طµط±ظپ ط§ظ„ظپط¹ظ„ظٹ",

    en: "Record actual disbursement",

    ur: "ط§طµظ„ ط§ط¯ط§ط¦غŒع¯غŒ ط¯ط±ط¬ ع©ط±غŒع؛",
  },

  {
    code: "p1.retention.release",

    module: "phaseOne",

    action: "retention_release",

    ar: "ط§ظ„ط¥ظپط±ط§ط¬ ط¹ظ† ط¶ظ…ط§ظ† ط§ظ„ط£ط¹ظ…ط§ظ„",

    en: "Release retention",

    ur: "ط±ظˆع©غŒ ع¯ط¦غŒ ط¶ظ…ط§ظ†طھ ط¬ط§ط±غŒ ع©ط±غŒع؛",
  },

  {
    code: "p1.print",

    module: "phaseOne",

    action: "print",

    ar: "ط·ط¨ط§ط¹ط© ط§ظ„ط¹ظ‚ظˆط¯ ظˆط§ظ„ظ…ط³طھط®ظ„طµط§طھ",

    en: "Print contracts and certificates",

    ur: "ظ…ط¹ط§غپط¯غ’ ط§ظˆط± ظ…ط³طھط®ظ„طµ ظ¾ط±ظ†ظ¹ ع©ط±غŒع؛",
  },

  {
    code: "users.edit",

    module: "users",

    action: "edit",

    ar: "طھط¹ط¯ظٹظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…",

    en: "Edit user details",

    ur: "طµط§ط±ظپ ع©غŒ ظ…ط¹ظ„ظˆظ…ط§طھ طھط¨ط¯غŒظ„ ع©ط±غŒع؛",
  },

  {
    code: "users.password.reset",

    module: "users",

    action: "password_reset",

    ar: "طھط؛ظٹظٹط± ظƒظ„ظ…ط§طھ ظ…ط±ظˆط± ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ†",

    en: "Reset user passwords",

    ur: "طµط§ط±ظپ ع©ط§ ظ¾ط§ط³ ظˆط±عˆ طھط¨ط¯غŒظ„ ع©ط±غŒع؛",
  },

  {
    code: "users.status.manage",

    module: "users",

    action: "status_manage",

    ar: "طھط¹ط·ظٹظ„ ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ† ظˆطھظپط¹ظٹظ„ظ‡ظ…",

    en: "Deactivate and activate users",

    ur: "طµط§ط±ظپ ظپط¹ط§ظ„ غŒط§ ط؛غŒط± ظپط¹ط§ظ„ ع©ط±غŒع؛",
  },

  {
    code: "suppliers.view",

    module: "suppliers",

    action: "view",

    ar: "ط¹ط±ط¶ ط§ظ„ظ…ظˆط±ط¯ظٹظ†",

    en: "View suppliers",

    ur: "ط³ظ¾ظ„ط§ط¦ط±ط² ط¯غŒع©ع¾غŒع؛",
  },

  {
    code: "suppliers.create",

    module: "suppliers",

    action: "create",

    ar: "ط¥ط¶ط§ظپط© ظ…ظˆط±ط¯",

    en: "Create supplier",

    ur: "ط³ظ¾ظ„ط§ط¦ط± ط´ط§ظ…ظ„ ع©ط±غŒع؛",
  },

  {
    code: "suppliers.edit",

    module: "suppliers",

    action: "edit",

    ar: "طھط¹ط¯ظٹظ„ ظ…ظˆط±ط¯",

    en: "Edit supplier",

    ur: "ط³ظ¾ظ„ط§ط¦ط± طھط¨ط¯غŒظ„ ع©ط±غŒع؛",
  },

  {
    code: "documents.view",

    module: "documents",

    action: "view",

    ar: "ط¹ط±ط¶ ط§ظ„ظˆط«ط§ط¦ظ‚",

    en: "View documents",

    ur: "ط¯ط³طھط§ظˆغŒط²ط§طھ ط¯غŒع©ع¾غŒع؛",
  },

  {
    code: "documents.view_confidential",

    module: "documents",

    action: "view_confidential",

    ar: "ط¹ط±ط¶ ط§ظ„ظˆط«ط§ط¦ظ‚ ط§ظ„ط³ط±ظٹط©",

    en: "View confidential documents",

    ur: "ط®ظپغŒغپ ط¯ط³طھط§ظˆغŒط²ط§طھ ط¯غŒع©ع¾غŒع؛",
  },

  {
    code: "documents.upload",

    module: "documents",

    action: "upload",

    ar: "ط±ظپط¹ ظˆط«ط§ط¦ظ‚",

    en: "Upload documents",

    ur: "ط¯ط³طھط§ظˆغŒط²ط§طھ ط§ظ¾ ظ„ظˆعˆ ع©ط±غŒع؛",
  },

  {
    code: "users.view",

    module: "users",

    action: "view",

    ar: "ط¹ط±ط¶ ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ†",

    en: "View users",

    ur: "طµط§ط±ظپغŒظ† ط¯غŒع©ع¾غŒع؛",
  },

  {
    code: "users.create",

    module: "users",

    action: "create",

    ar: "ط¥ظ†ط´ط§ط، ظ…ط³طھط®ط¯ظ…",

    en: "Create user",

    ur: "طµط§ط±ظپ ط¨ظ†ط§ط¦غŒع؛",
  },
] as const;

export type AtomicPermissionCode = (typeof ATOMIC_PERMISSIONS)[number]["code"];

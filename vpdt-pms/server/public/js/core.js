// ==========================================
// HA TANG: NAP MODULE THEO CUM (LAZY LOAD) - dot 7
// ==========================================
// 39 file public/js/*.js truoc day nap EAGER het (script src tinh trong index.html). Doan nay
// thay 34 file module-*.js (khong tinh 5 file core*.js luon nap san) bang co che nap LUOI theo
// CUM (group) khi thuc su can - xem switchTab()/cspDispatchOp() ben duoi goi loadModuleGroup().
//
// MODULE_LOAD_GROUPS: cum duoc tinh bang cong cu AST that (khong doan tay) - quet MOI tham chieu
// identifier & tham chieu qua data-op="..."/data-op-seq="..." xuyen suot 34 file, gop nhung file
// PHU THUOC VONG (SCC) lai thanh 1 cum bat buoc nap chung, cum nao phu thuoc cum khac thi ghi o
// deps (loadModuleGroup() tu dong nap ĐỆ QUY deps truoc/cung luc). files: ten file trong /js/.
const MODULE_LOAD_GROUPS = {"formbuilder-nav":{"files":["module-tailieu.js","module-formbuilder-nav.js"],"deps":[]},"congviec":{"files":["module-congviec.js"],"deps":[]},"bienbanhop":{"files":["module-bienbanhop.js"],"deps":["congviec","formbuilder-nav"]},"admin-permgroups":{"files":["module-admin.js","module-admin-permtree.js","module-admin-permgroups.js","module-admin-submissiongroups.js","module-admin-userstaging.js","module-internalcomms-daotao.js"],"deps":["bienbanhop","formbuilder-nav"]},"admin-specialperm":{"files":["module-admin-specialperm.js"],"deps":[]},"internalcomms-daotao-viewer":{"files":["module-internalcomms-daotao-viewer.js"],"deps":["formbuilder-nav"]},"baocaodinhky-nhap":{"files":["module-baocaodinhky-nhap.js","module-baocaodinhky-trinhchieu.js"],"deps":["formbuilder-nav","internalcomms-daotao-viewer"]},"dongphuc":{"files":["module-dongphuc.js"],"deps":["admin-permgroups"]},"baocaoquantri-preview":{"files":["module-baocaoquantri-preview.js","module-baocaoquantri.js"],"deps":["admin-permgroups","baocaodinhky-nhap","dongphuc","formbuilder-nav"]},"dangkyxe":{"files":["module-dangkyxe.js"],"deps":["bienbanhop","formbuilder-nav"]},"hcrcdonghanh":{"files":["module-hcrcdonghanh.js"],"deps":["admin-permgroups","bienbanhop"]},"itsupport-renewal":{"files":["module-itsupport-renewal.js"],"deps":["formbuilder-nav"]},"itsupport-price":{"files":["module-itsupport-price.js"],"deps":["formbuilder-nav","itsupport-renewal"]},"workflow":{"files":["module-workflow.js"],"deps":[]},"itsupport-tier":{"files":["module-ngansach.js","module-itsupport-tier.js"],"deps":["admin-permgroups","admin-specialperm","baocaodinhky-nhap","formbuilder-nav","internalcomms-daotao-viewer","itsupport-price","workflow"]},"logsystem-trash":{"files":["module-logsystem-trash.js"],"deps":["admin-permgroups"]},"hethong-tabs":{"files":["module-hethong-tabs.js"],"deps":["admin-permgroups","admin-specialperm","formbuilder-nav","itsupport-tier","logsystem-trash"]},"vanbantrinh":{"files":["module-vanbantrinh.js"],"deps":["congviec","formbuilder-nav"]},"vpp":{"files":["module-vpp.js"],"deps":["admin-specialperm","formbuilder-nav"]},"hopdong":{"files":["module-hopdong.js","module-thanhtoan.js","module-office.js"],"deps":["formbuilder-nav","vanbantrinh","vpp"]},"phonghop":{"files":["module-phonghop.js"],"deps":["formbuilder-nav"]},"internalcomms-nhipsong":{"files":["module-internalcomms-nhipsong.js"],"deps":["admin-permgroups","formbuilder-nav","hcrcdonghanh","phonghop"]},"vanhanh":{"files":["module-vanhanh.js"],"deps":["admin-permgroups","bienbanhop","formbuilder-nav"]}};

// MODULE_FN_GROUP: tra CHINH XAC 1 identifier top-level (function/const/let/class hoac window.X=)
// duoc dinh nghia o file module-*.js NAO thuoc cum nao - dung cho ensureFnReady() (goi qua ten
// chuoi, vd cspDispatchOp() data-op="...") va cho nguoi debug tra cuu nhanh.
const MODULE_FN_GROUP = {"toggleUserPermFormMode":"admin-permgroups","updatePermGroupNote":"admin-permgroups","currentEditingUserGroupIds":"admin-permgroups","onUserPermGroupsChange":"admin-permgroups","renderUPermGroupsChecklist":"admin-permgroups","renderPermGroupsList":"admin-permgroups","renderGroupMembersPicker":"admin-permgroups","startCreateGroup":"admin-permgroups","editPermGroup":"admin-permgroups","savePermGroup":"admin-permgroups","deletePermGroup":"admin-permgroups","setAllPermTreeNodes":"admin-permgroups","computePermTreeNodeCount":"admin-permgroups","refreshPermTreeBadges":"admin-permgroups","filterPermTree":"admin-permgroups","markPermTreeDirty":"admin-permgroups","clearPermTreeDirtyMarks":"admin-permgroups","onApproverAuthLevelChange":"admin-permgroups","collectPermsFromForm":"admin-permgroups","populatePermsForm":"admin-permgroups","getWorkflowParticipatingDepts":"admin-specialperm","workflowParticipatingDeptsDraft":"admin-specialperm","renderWorkflowParticipatingDeptsChecklist":"admin-specialperm","addWorkflowParticipatingDept":"admin-specialperm","removeWorkflowParticipatingDept":"admin-specialperm","saveWorkflowParticipatingDepts":"admin-specialperm","PWA_SHORTCUT_CATALOG_CLIENT":"admin-specialperm","PWA_SHORTCUT_MAX":"admin-specialperm","renderPwaShortcutCheckboxes":"admin-specialperm","enforcePwaShortcutMax":"admin-specialperm","savePwaShortcutModules":"admin-specialperm","canRegisterVpp":"admin-specialperm","isUserVppExcluded":"admin-specialperm","vppExcludedJobTitlesDraft":"admin-specialperm","renderVppExcludedJobTitlesChecklist":"admin-specialperm","addVppExcludedJobTitle":"admin-specialperm","removeVppExcludedJobTitle":"admin-specialperm","saveVppExcludedJobTitles":"admin-specialperm","renderSubmissionApprovalGroups":"admin-permgroups","saveSubmissionApprovalGroup":"admin-permgroups","renderContractApprovalGroups":"admin-permgroups","saveContractApprovalGroup":"admin-permgroups","cancelPermFormEdit":"admin-permgroups","onUserPosTypeChange":"admin-permgroups","readUserFormState":"admin-permgroups","buildNewUserFromState":"admin-permgroups","saveUser":"admin-permgroups","addUserToStagingList":"admin-permgroups","renderPendingNewUsersList":"admin-permgroups","removePendingNewUser":"admin-permgroups","editPendingNewUser":"admin-permgroups","commitPendingNewUsers":"admin-permgroups","resetUserForm":"admin-permgroups","setAdminAccountPermsLocked":"admin-permgroups","editUser":"admin-permgroups","deleteUser":"admin-permgroups","toggleUserActive":"admin-permgroups","summarizeUserPerms":"admin-permgroups","onUserFilterChange":"admin-permgroups","renderUsers":"admin-permgroups","downloadXlsxFromServer":"admin-permgroups","downloadUserTemplate":"admin-permgroups","exportUsersExcel":"admin-permgroups","importUsersExcel":"admin-permgroups","saveDept":"admin-permgroups","deleteDept":"admin-permgroups","updateDeptAbbr":"admin-permgroups","renderDeptList":"admin-permgroups","saveStore":"admin-permgroups","deleteStore":"admin-permgroups","renderStoreList":"admin-permgroups","renameCatalogEntryClient":"admin-permgroups","renameStore":"admin-permgroups","storeImportPreviewItems":"admin-permgroups","onStoreImportFileChange":"admin-permgroups","confirmStoreImport":"admin-permgroups","moveDeptToStore":"admin-permgroups","saveJobTitle":"admin-permgroups","deleteJobTitle":"admin-permgroups","renderJobTitleList":"admin-permgroups","renameJobTitle":"admin-permgroups","saveStoreJobTitle":"admin-permgroups","deleteStoreJobTitle":"admin-permgroups","toggleStoreJobTitleRestricted":"admin-permgroups","toggleStoreJobTitleRestrictedFromCheckbox":"admin-permgroups","renameStoreJobTitle":"admin-permgroups","renderStoreJobTitleList":"admin-permgroups","saveTrainingCategory":"admin-permgroups","deleteTrainingCategory":"admin-permgroups","renderTrainingCategoryList":"admin-permgroups","saveSensitiveKeyword":"admin-permgroups","deleteSensitiveKeyword":"admin-permgroups","renderSensitiveKeywordList":"admin-permgroups","saveCat":"admin-permgroups","deleteCat":"admin-permgroups","updateCatAbbr":"admin-permgroups","renderCatList":"admin-permgroups","updateContractTypeAbbr":"admin-permgroups","renderContractTypeAbbrList":"admin-permgroups","buildModuleTabNotesHTML":"admin-permgroups","renderModuleAccessCheckboxes":"admin-permgroups","readModuleAccessFromForm":"admin-permgroups","populateModuleAccessForm":"admin-permgroups","renderDeptCheckboxes":"admin-permgroups","toggleScopeGroup":"admin-permgroups","scopeFromForm":"admin-permgroups","activePeriodicReportSubTab":"baocaodinhky-nhap","prEntryDraftId":"baocaodinhky-nhap","prEntryExistingFile":"baocaodinhky-nhap","prEntryPendingFile":"baocaodinhky-nhap","prEntryMode":"baocaodinhky-nhap","prAggCurrentPeriodId":"baocaodinhky-nhap","prAggSelectedIds":"baocaodinhky-nhap","prAggPendingSlides":"baocaodinhky-nhap","prAggPdfSelectedIds":"baocaodinhky-nhap","prAggPdfPages":"baocaodinhky-nhap","prAggPdfDragFromIndex":"baocaodinhky-nhap","prAggPdfEntryPagesCache":"baocaodinhky-nhap","prSlideshowSlides":"baocaodinhky-nhap","prSlideshowIndex":"baocaodinhky-nhap","prSlideshowTemplate":"baocaodinhky-nhap","canManageReportPeriodsClient":"baocaodinhky-nhap","canCreateReportEntryClient":"baocaodinhky-nhap","reportPeriodIsOpen":"baocaodinhky-nhap","reportPeriodIsClosed":"baocaodinhky-nhap","reportPeriodDeptAllowed":"baocaodinhky-nhap","reportPeriodDeptLabel":"baocaodinhky-nhap","formatDateTimeVN":"baocaodinhky-nhap","formatDateVN":"baocaodinhky-nhap","setPeriodicReportSubTab":"baocaodinhky-nhap","findOwnReportEntryForPeriod":"baocaodinhky-nhap","renderPrEntryPeriodOptions":"baocaodinhky-nhap","toIsoDateForInput":"baocaodinhky-nhap","renderPrItemsTable":"baocaodinhky-nhap","collectPrItemsTable":"baocaodinhky-nhap","addPrItemRow":"baocaodinhky-nhap","removePrItemRow":"baocaodinhky-nhap","onPrEntryPdfFilesChange":"baocaodinhky-nhap","showPrExistingFileHint":"baocaodinhky-nhap","onPrEntryPeriodChange":"baocaodinhky-nhap","uploadPrOptionalFile":"baocaodinhky-nhap","savePrEntryDraft":"baocaodinhky-nhap","submitPrEntry":"baocaodinhky-nhap","submitPrEntryAction":"baocaodinhky-nhap","prEntryStatusBadge":"baocaodinhky-nhap","renderPrEntryTable":"baocaodinhky-nhap","runPrEntryAction":"baocaodinhky-nhap","editPrEntryDraft":"baocaodinhky-nhap","deletePrEntryAction":"baocaodinhky-nhap","renderReportDeptCheckboxes":"baocaodinhky-nhap","createReportPeriod":"baocaodinhky-nhap","prPeriodStatusBadge":"baocaodinhky-nhap","renderPrPeriodsTable":"baocaodinhky-nhap","runPrPeriodAction":"baocaodinhky-nhap","closePrPeriodAction":"baocaodinhky-nhap","deletePrPeriodAction":"baocaodinhky-nhap","renderPrAggPeriodOptions":"baocaodinhky-nhap","onPrAggPeriodChange":"baocaodinhky-nhap","getPrAggPeriodEntries":"baocaodinhky-nhap","getPrAggPdfPeriodEntries":"baocaodinhky-nhap","renderPrAggEntriesList":"baocaodinhky-nhap","togglePrAggEntry":"baocaodinhky-nhap","onPrAggEntryCheckboxChange":"baocaodinhky-nhap","untogglePrAggEntry":"baocaodinhky-nhap","movePrAggEntry":"baocaodinhky-nhap","renderPrAggOrderList":"baocaodinhky-nhap","mergeReportPeriodAction":"baocaodinhky-nhap","ensureEntryPagesCached":"baocaodinhky-nhap","loadPrAggPdfThumbnails":"baocaodinhky-nhap","renderPrAggPdfEntriesList":"baocaodinhky-nhap","onPrAggPdfEntryCheckboxChange":"baocaodinhky-nhap","togglePrAggPdfEntry":"baocaodinhky-nhap","renderPrAggPdfGrid":"baocaodinhky-nhap","updatePrAggPdfActionsWrap":"baocaodinhky-nhap","renderPrAggPdfSection":"baocaodinhky-nhap","mergeReportPeriodPdfAction":"baocaodinhky-nhap","publishPrPdfCompilation":"baocaodinhky-nhap","unpublishPrPdfCompilation":"baocaodinhky-nhap","mergeReportPeriodByTasksAction":"baocaodinhky-nhap","exportPrTaskCompilationPdf":"baocaodinhky-nhap","exportPrTaskCompilationExcel":"baocaodinhky-nhap","renderPrTaskCompilation":"baocaodinhky-nhap","PR_SLIDE_KIND_LABELS":"baocaodinhky-nhap","PR_SLIDE_TEMPLATES":"baocaodinhky-nhap","getPrSlideTemplateColors":"baocaodinhky-nhap","renderPrAggCompilation":"baocaodinhky-nhap","updatePrAggSlideField":"baocaodinhky-nhap","updatePrAggPptxBodyLines":"baocaodinhky-nhap","syncPrAggSlideItems":"baocaodinhky-nhap","addPrAggItemRow":"baocaodinhky-nhap","removePrAggItemRow":"baocaodinhky-nhap","removePrAggSlideFile":"baocaodinhky-nhap","movePrAggSlide":"baocaodinhky-nhap","removePrAggSlide":"baocaodinhky-nhap","savePrCompilation":"baocaodinhky-nhap","publishPrCompilation":"baocaodinhky-nhap","unpublishPrCompilation":"baocaodinhky-nhap","renderPrPublishedTable":"baocaodinhky-nhap","prSlideshowMode":"baocaodinhky-nhap","openPrSlideshow":"baocaodinhky-nhap","prPdfFsDoc":"baocaodinhky-nhap","openPrPdfFullscreen":"baocaodinhky-nhap","renderPrPdfFsPage":"baocaodinhky-nhap","toRomanNumeral":"baocaodinhky-nhap","buildPrTaskTableHTML":"baocaodinhky-nhap","viewPrCurrentSlideFile":"baocaodinhky-nhap","buildPrFileBlockHTML":"baocaodinhky-nhap","buildPrSlideBodyHTML":"baocaodinhky-nhap","buildPrPptxSlideBodyHTML":"baocaodinhky-nhap","buildPrSlideScreenHTML":"baocaodinhky-nhap","applyPrTemplateBackground":"baocaodinhky-nhap","preloadImage":"baocaodinhky-nhap","renderPrSlideshowSlide":"baocaodinhky-nhap","prSlideshowNav":"baocaodinhky-nhap","closePrSlideshow":"baocaodinhky-nhap","prPdfLibsPromise":"baocaodinhky-nhap","loadPrPdfLibs":"baocaodinhky-nhap","PR_PDF_SLIDE_WIDTH":"baocaodinhky-nhap","PR_PDF_SLIDE_HEIGHT":"baocaodinhky-nhap","downloadPrPdf":"baocaodinhky-nhap","currentReportPreviewModuleKey":"baocaoquantri-preview","buildReportPreviewLauncherHTML":"baocaoquantri-preview","buildReportPreviewDocumentHTML":"baocaoquantri-preview","showReportPreview":"baocaoquantri-preview","closeReportPreviewModal":"baocaoquantri-preview","printReportPreview":"baocaoquantri-preview","exportReportPreviewExcel":"baocaoquantri-preview","renderReportDetailSection":"baocaoquantri-preview","renderContractReportExtra":"baocaoquantri-preview","renderOfficeReportExtra":"baocaoquantri-preview","renderUniformReportExtra":"baocaoquantri-preview","renderTaskReportExtra":"baocaoquantri-preview","renderInternalReportExtra":"baocaoquantri-preview","exportModuleReportExcel":"baocaoquantri-preview","renderReportsSummary":"baocaoquantri-preview","exportReportsExcel":"baocaoquantri-preview","exportReportsSummaryExcel":"baocaoquantri-preview","formatHoursLabel":"baocaoquantri-preview","buildStatBarHTML":"baocaoquantri-preview","computeApprovalStats":"baocaoquantri-preview","resetReportsFilters":"baocaoquantri-preview","reportsNavL1":"baocaoquantri-preview","reportsNavL2":"baocaoquantri-preview","REPORT_NAV_TREE":"baocaoquantri-preview","isReportNavNodeVisible":"baocaoquantri-preview","findReportNavNode":"baocaoquantri-preview","getActiveReportLeafKey":"baocaoquantri-preview","renderReportsNavPicker":"baocaoquantri-preview","selectReportsNavL1":"baocaoquantri-preview","selectReportsNavL2":"baocaoquantri-preview","repopulateReportsDeptFilterOptions":"baocaoquantri-preview","renderReports":"baocaoquantri-preview","REPORT_MODULE_CONFIGS":"baocaoquantri-preview","renderModuleReport":"baocaoquantri-preview","reportDetailContext":"baocaoquantri-preview","reportDetailFilterValues":"baocaoquantri-preview","reportDetailSelectedCols":"baocaoquantri-preview","REPORT_FIELD_LABELS":"baocaoquantri-preview","humanizeReportFieldKey":"baocaoquantri-preview","REPORT_FIELD_EXCLUDE_KEYS":"baocaoquantri-preview","inferReportFieldType":"baocaoquantri-preview","buildReportDetailColumns":"baocaoquantri-preview","formatReportDetailValue":"baocaoquantri-preview","applyReportDetailFilters":"baocaoquantri-preview","buildReportDetailFilterControlHTML":"baocaoquantri-preview","onReportDetailFilterInput":"baocaoquantri-preview","onReportDetailColumnToggle":"baocaoquantri-preview","onReportDetailColumnToggleFromCheckbox":"baocaoquantri-preview","resetReportDetailFilters":"baocaoquantri-preview","buildReportDetailResultsHTML":"baocaoquantri-preview","renderReportDetailResultsOnly":"baocaoquantri-preview","exportReportDetailExcel":"baocaoquantri-preview","onMinutesFilterChange":"bienbanhop","populateMinutesLinkSelect":"bienbanhop","onMinutesLinkedMeetingChange":"bienbanhop","addAttendeeRow":"bienbanhop","renderMeetingAttendeeTemplateSelect":"bienbanhop","applyMeetingAttendeeTemplateFromSelect":"bienbanhop","applyMeetingAttendeeTemplate":"bienbanhop","saveMeetingAttendeeTemplate":"bienbanhop","deleteMeetingAttendeeTemplate":"bienbanhop","tplEditRows":"bienbanhop","tplEditingId":"bienbanhop","openAttendeeTemplateManagerModal":"bienbanhop","closeAttendeeTemplateManagerModal":"bienbanhop","showAttendeeTemplateListView":"bienbanhop","renderAttendeeTemplateManagerList":"bienbanhop","openAttendeeTemplateEditor":"bienbanhop","backToAttendeeTemplateList":"bienbanhop","addTplEditRow":"bienbanhop","removeTplEditRow":"bienbanhop","updateTplEditField":"bienbanhop","applyTplRowSystemUser":"bienbanhop","toggleTplRowHasAccount":"bienbanhop","resolveTplRowAccountInput":"bienbanhop","renderTplEditRowsTable":"bienbanhop","saveAttendeeTemplateFromEditor":"bienbanhop","deleteAttendeeTemplateFromManager":"bienbanhop","removeAttendeeRow":"bienbanhop","updateAttendeeField":"bienbanhop","applyAttendeeSystemUser":"bienbanhop","toggleAttendeeHasAccount":"bienbanhop","resolveAttendeeAccountInput":"bienbanhop","populateSystemUsersDatalist":"bienbanhop","populateCarDriversDatalist":"bienbanhop","renderAttendeesTable":"bienbanhop","addMinutesDirectiveRow":"bienbanhop","removeMinutesDirectiveRow":"bienbanhop","updateMinutesDirectiveField":"bienbanhop","updateMinutesDirectiveFieldMultiSelect":"bienbanhop","renderMinutesDirectivesTable":"bienbanhop","applyAutoCreatedTasks":"bienbanhop","pendingMinutesEmailNotify":"bienbanhop","openMinutesEmailComposeModal":"bienbanhop","renderMinutesEmailRecipientsList":"bienbanhop","toggleAllMinutesEmailRecipients":"bienbanhop","closeMinutesEmailComposeModal":"bienbanhop","confirmSendMinutesEmail":"bienbanhop","submitMeetingMinutes":"bienbanhop","openEditMeetingMinutes":"bienbanhop","cancelEditMeetingMinutes":"bienbanhop","updateMeetingMinutes":"bienbanhop","renderMeetingMinutes":"bienbanhop","runMinutesAction":"bienbanhop","confirmAssignMinutesTasks":"bienbanhop","assignMinutesTasksAction":"bienbanhop","deleteMeetingMinutes":"bienbanhop","viewMeetingMinutesDetails":"bienbanhop","buildMeetingMinutesDocumentHTML":"bienbanhop","downloadMeetingMinutes":"bienbanhop","pendingTaskSource":"congviec","editingTaskId":"congviec","taskModalMode":"congviec","populateTaskCollaboratorsSelect":"congviec","resolveTaskAssigneeInput":"congviec","setTaskAssigneeSingle":"congviec","setTaskAssigneeMode":"congviec","openCreateTaskModal":"congviec","openAssignTaskModal":"congviec","openEditTaskModal":"congviec","closeCreateTaskModal":"congviec","notifyTaskCollaborators":"congviec","confirmCreateTask":"congviec","createTaskFromSubmission":"congviec","createTaskFromMinutesDirective":"congviec","updateTaskStatus":"congviec","acceptTask":"congviec","acceptTaskOnBehalf":"congviec","confirmCollaboratorParticipation":"congviec","confirmCollaboratorParticipationOnBehalf":"congviec","progressingTaskId":"congviec","TASK_STATUS_LABELS":"congviec","openTaskProgressModal":"congviec","renderProgressSubtasksList":"congviec","addSubtaskAction":"congviec","toggleSubtaskAction":"congviec","deleteSubtaskAction":"congviec","closeTaskProgressModal":"congviec","confirmTaskProgress":"congviec","requestingExtensionTaskId":"congviec","openExtensionRequestModal":"congviec","closeExtensionRequestModal":"congviec","confirmRequestExtension":"congviec","openExtensionApproveModal":"congviec","closeExtensionApproveModal":"congviec","approveExtension":"congviec","rejectExtension":"congviec","cancellingTaskId":"congviec","openCancelTaskModal":"congviec","closeCancelTaskModal":"congviec","confirmCancelTask":"congviec","openCancelApproveModal":"congviec","closeCancelApproveModal":"congviec","approveCancellation":"congviec","rejectCancellation":"congviec","openTaskDetailModal":"congviec","closeTaskDetailModal":"congviec","onTaskFilterChange":"congviec","renderTasks":"congviec","runTaskAction":"congviec","deleteTask":"congviec","buildTaskSlipHTML":"congviec","downloadTaskSlip":"congviec","resetTaskFilters":"congviec","submitCarReq":"dangkyxe","resetCarRoutePoints":"dangkyxe","addCarRoutePoint":"dangkyxe","removeCarRoutePoint":"dangkyxe","updateCarRoutePoint":"dangkyxe","renderCarRoutePoints":"dangkyxe","setCarSubTab":"dangkyxe","renderCarDriverTab":"dangkyxe","confirmCarDriverAssignmentAction":"dangkyxe","onCarFilterChange":"dangkyxe","filterCarByCard":"dangkyxe","renderCarRegs":"dangkyxe","runCarAction":"dangkyxe","deleteCarRegAction":"dangkyxe","resolveCarAssignedDriverInput":"dangkyxe","openCarProcessModal":"dangkyxe","closeCarProcessModal":"dangkyxe","confirmProcessCarReg":"dangkyxe","processCarReg":"dangkyxe","activeUniformSubTab":"dongphuc","uniformAllocBlocks":"dongphuc","uniformIssueItems":"dongphuc","uniformStoreEmployeesCache":"dongphuc","canManageUniform":"dongphuc","canManageUniformStore":"dongphuc","canApproveUniformClient":"dongphuc","setUniformSubTab":"dongphuc","populateUniformEmployeeGroupOptions":"dongphuc","resetUniformEmployeeCreateForm":"dongphuc","submitUniformEmployeeCreate":"dongphuc","renderUniformEmployeesList":"dongphuc","lockUniformEmployeeAction":"dongphuc","uniformSkuFor":"dongphuc","formatUniformLabel":"dongphuc","uniformItemsSummary":"dongphuc","renderUniformCatalogList":"dongphuc","saveUniformCatalogItem":"dongphuc","deleteUniformCatalogItem":"dongphuc","resetUniformPeriodForm":"dongphuc","addUniformAllocationBlock":"dongphuc","removeUniformAllocationBlock":"dongphuc","updateUniformAllocDept":"dongphuc","resolveUniformAllocDeptInput":"dongphuc","addUniformAllocItemRow":"dongphuc","removeUniformAllocItemRow":"dongphuc","updateUniformAllocItemField":"dongphuc","renderUniformAllocationBlocks":"dongphuc","submitUniformPeriod":"dongphuc","uniformAllocStatusBadge":"dongphuc","uniformPeriodApprovalBadge":"dongphuc","filterUniformPeriodByCard":"dongphuc","renderUniformPeriodsList":"dongphuc","approveUniformPeriodAction":"dongphuc","rejectUniformPeriodAction":"dongphuc","deleteUniformPeriodAction":"dongphuc","renderUniformPendingAllocations":"dongphuc","confirmUniformAllocationAction":"dongphuc","renderUniformIssueEmployeeOptions":"dongphuc","resolveUniformEmployeeInput":"dongphuc","resolveUniformAdjEmpEmployeeInputAndRefresh":"dongphuc","resetUniformIssueForm":"dongphuc","addUniformIssueItemRow":"dongphuc","removeUniformIssueItemRow":"dongphuc","updateUniformIssueItemField":"dongphuc","updateUniformIssueItemNameSize":"dongphuc","renderUniformIssueItems":"dongphuc","callCreateUniformIssuance":"dongphuc","submitUniformIssuance":"dongphuc","renderUniformIssuancesTable":"dongphuc","computeAllEmployeeUniformHoldingsClient":"dongphuc","uniformHoldingsCache":"dongphuc","renderUniformHoldingsTable":"dongphuc","openUniformHoldingActionModal":"dongphuc","renderUniformAdjStockItemOptions":"dongphuc","resetUniformAdjustForms":"dongphuc","renderUniformAdjEmpItemOptions":"dongphuc","onUniformAdjEmpItemSizeChange":"dongphuc","callCreateUniformStockAdjustment":"dongphuc","submitUniformStockAdjustment":"dongphuc","uniformAdjOutcomeLabel":"dongphuc","renderUniformAdjustmentsTable":"dongphuc","computeUniformStockClient":"dongphuc","computeUniformStockBreakdownClient":"dongphuc","uniformStockExpandedKeys":"dongphuc","uniformStockRowKey":"dongphuc","uniformPeriodBreakdownFor":"dongphuc","toggleUniformStockDetail":"dongphuc","renderUniformStockStoreFilterOptions":"dongphuc","renderUniformStock":"dongphuc","canViewUniformTransferClient":"dongphuc","resetUniformTransferForm":"dongphuc","callCreateUniformTransfer":"dongphuc","submitUniformTransfer":"dongphuc","uniformTransferStatusBadge":"dongphuc","renderUniformTransferApprovalQueue":"dongphuc","approveUniformTransferAction":"dongphuc","rejectUniformTransferAction":"dongphuc","filterUniformTransferByCard":"dongphuc","renderUniformTransfersTable":"dongphuc","renderUniformDashboard":"dongphuc","uniformDashByStoreCache":"dongphuc","exportUniformDashByStoreExcel":"dongphuc","renderFormTabsBar":"formbuilder-nav","renderFormSubTabsBar":"formbuilder-nav","switchFormGroup":"formbuilder-nav","switchFormTab":"formbuilder-nav","toggleOptionsInput":"formbuilder-nav","addCustomField":"formbuilder-nav","editCustomField":"formbuilder-nav","editCoreField":"formbuilder-nav","cancelEditCustomField":"formbuilder-nav","deleteCustomField":"formbuilder-nav","moveCustomField":"formbuilder-nav","FIELD_TYPE_LABELS":"formbuilder-nav","renderFormFieldsTable":"formbuilder-nav","getDynamicContainerId":"formbuilder-nav","renderDynamicInputsForModule":"formbuilder-nav","collectDynamicFieldsData":"formbuilder-nav","prefillDynamicFieldsData":"formbuilder-nav","HR_FEEDBACK_CATEGORY_LABELS":"hcrcdonghanh","HR_FEEDBACK_STATUS_BADGES":"hcrcdonghanh","submitHrFeedbackQuestion":"hcrcdonghanh","renderHrFeedbackInbox":"hcrcdonghanh","openHrFeedbackAnswer":"hcrcdonghanh","updateHrFeedbackBadge":"hcrcdonghanh","getUserManagerName":"hcrcdonghanh","getDirectReports":"hcrcdonghanh","renderOrgChart":"hcrcdonghanh","buildOrgChartNode":"hcrcdonghanh","orgChartEditTarget":"hcrcdonghanh","openOrgChartManagerPicker":"hcrcdonghanh","closeOrgChartManagerPicker":"hcrcdonghanh","saveOrgChartManagerChange":"hcrcdonghanh","submitOrgChartManager":"hcrcdonghanh","clearOrgChartManager":"hcrcdonghanh","downloadOrgChartTemplate":"hcrcdonghanh","buildOrgChartExportRows":"hcrcdonghanh","exportOrgChartExcel":"hcrcdonghanh","importOrgChartExcel":"hcrcdonghanh","renderHrFeedbackManage":"hcrcdonghanh","submitHrFeedbackResponse":"hcrcdonghanh","positionAdminSubTabBar":"hethong-tabs","setSystemSubTab":"hethong-tabs","setAdminSubTab":"hethong-tabs","renderExternalApiKeysTable":"hethong-tabs","createExternalApiKeyAction":"hethong-tabs","editExternalApiKeyAllowedIpsAction":"hethong-tabs","closeExtApiKeyRevealBox":"hethong-tabs","copyExternalApiKeyReveal":"hethong-tabs","revokeExternalApiKeyAction":"hethong-tabs","editingContractId":"hopdong","setContractSubTab":"hopdong","onContractOpModeChange":"hopdong","refreshContractCodePreview":"hopdong","populateContractAddendumTargets":"hopdong","resolveContractAddendumTargetInput":"hopdong","onContractAddendumTargetChange":"hopdong","getContractAmountValue":"hopdong","renderContractInstallmentsList":"hopdong","onContractInstallmentPercentInput":"hopdong","onContractInstallmentAmountInput":"hopdong","recalcContractInstallmentAmountsFromPercent":"hopdong","addContractInstallmentRow":"hopdong","removeContractInstallmentRow":"hopdong","collectContractInstallments":"hopdong","submitContractReq":"hopdong","openEditContract":"hopdong","cancelEditContract":"hopdong","updateContractReq":"hopdong","onContractFilterChange":"hopdong","filterContractByCard":"hopdong","getContractFamily":"hopdong","toggleContractFamily":"hopdong","CONTRACT_PAYMENT_LABELS":"hopdong","CONTRACT_PAYMENT_BADGE_CLS":"hopdong","renderContracts":"hopdong","buildContractRowHTML":"hopdong","runContractAction":"hopdong","deleteContractAction":"hopdong","approveContractAction":"hopdong","rejectContractAction":"hopdong","approveContractSignedFileAction":"hopdong","rejectContractSignedFileAction":"hopdong","requestContractChangesAction":"hopdong","requestContractSignedFileChangesAction":"hopdong","signedUploadTarget":"hopdong","openSignedUploadModal":"hopdong","closeSignedUploadModal":"hopdong","submitSignedUpload":"hopdong","startContractPaymentAction":"hopdong","startOfficePaymentAction":"hopdong","buildOfficeWatermarkOverlayEl":"internalcomms-daotao-viewer","WORD_PDF_PAGE_W":"internalcomms-daotao-viewer","WORD_PDF_PAGE_H":"internalcomms-daotao-viewer","WORD_PDF_MARGIN":"internalcomms-daotao-viewer","WORD_PDF_CAPTURE_SCALE":"internalcomms-daotao-viewer","renderWordProtected":"internalcomms-daotao-viewer","printWordWithWatermark":"internalcomms-daotao-viewer","renderExcelProtected":"internalcomms-daotao-viewer","canManageTrainingLocal":"admin-permgroups","canManageTrainingClassLocal":"admin-permgroups","getTrainingClassSessionState":"admin-permgroups","TRAINING_SESSION_STATE_LABELS":"admin-permgroups","getTrainingRegDisplayStatus":"admin-permgroups","activeTrainingLmsTab":"admin-permgroups","setTrainingLmsTab":"admin-permgroups","populateTrainingCategorySelects":"admin-permgroups","populateTrainingCourseSelects":"admin-permgroups","populateTrainingPlanDeptSelects":"admin-permgroups","populateTrainingClassMultiSelects":"admin-permgroups","populateCpStageCourseSelectOptions":"admin-permgroups","addCpStageRow":"admin-permgroups","removeCpStageRow":"admin-permgroups","reindexCpStageRows":"admin-permgroups","populateCareerPathStageBuilder":"admin-permgroups","resetCareerPathForm":"admin-permgroups","renderTrainingLms":"admin-permgroups","onTrainingClassModeChange":"admin-permgroups","applyTrainingClassTestDefaultPassScore":"admin-permgroups","resolveTrainingInstructorInput":"admin-permgroups","tcInviteListStaged":"admin-permgroups","renderTrainingInviteListStagedList":"admin-permgroups","addTrainingInviteListPick":"admin-permgroups","removeTrainingInviteListStaged":"admin-permgroups","submitTrainingClass":"admin-permgroups","computeTrainingDashboard":"admin-permgroups","renderTrainingDashboard":"admin-permgroups","renderTrainingClasses":"admin-permgroups","startOfflineTrainingClassAction":"admin-permgroups","endOfflineTrainingClassAction":"admin-permgroups","resolveTrainingEditInstructorInput":"admin-permgroups","teInviteListStaged":"admin-permgroups","renderTrainingEditInviteListStagedList":"admin-permgroups","addTrainingEditInviteListPick":"admin-permgroups","removeTrainingEditInviteListStaged":"admin-permgroups","tcInviteFilePreviewItems":"admin-permgroups","teInviteFilePreviewItems":"admin-permgroups","onTrainingInviteFileChange":"admin-permgroups","addTrainingInviteFileFound":"admin-permgroups","exportTrainingInviteList":"admin-permgroups","openEditTrainingClassModal":"admin-permgroups","closeEditTrainingClassModal":"admin-permgroups","submitEditTrainingClass":"admin-permgroups","registerForTrainingClass":"admin-permgroups","deleteTrainingClass":"admin-permgroups","submitTrainingCourse":"admin-permgroups","renderTrainingCourses":"admin-permgroups","deleteTrainingCourse":"admin-permgroups","editingTrainingPlanId":"admin-permgroups","submitTrainingPlan":"admin-permgroups","cancelEditTrainingPlan":"admin-permgroups","openEditTrainingPlan":"admin-permgroups","deleteTrainingPlanAction":"admin-permgroups","renderTrainingPlans":"admin-permgroups","trainingPlanMonthRange":"admin-permgroups","trainingClassDurationHours":"admin-permgroups","getClassesForTrainingPlan":"admin-permgroups","getTrainingPlanActualStats":"admin-permgroups","getTrainingPlanCompletionPct":"admin-permgroups","isTrainingPlanOverdue":"admin-permgroups","computeTrainingPlanDashboard":"admin-permgroups","currentTrainingPlanDashboardData":"admin-permgroups","renderTrainingPlanDashboard":"admin-permgroups","exportTrainingPlanDashboardExcel":"admin-permgroups","trainingPlanImportPreviewItems":"admin-permgroups","onTrainingPlanImportFileChange":"admin-permgroups","confirmTrainingPlanImport":"admin-permgroups","openTrainingClassQrModal":"admin-permgroups","closeTrainingClassQrModal":"admin-permgroups","trainingResultsModalClassId":"admin-permgroups","openTrainingResultsModal":"admin-permgroups","closeTrainingResultsModal":"admin-permgroups","renderTrainingResultsModalBody":"admin-permgroups","saveTrainingResult":"admin-permgroups","approveCancelTrainingRegAction":"admin-permgroups","rejectCancelTrainingRegAction":"admin-permgroups","renderTrainingCancelRequestsQueue":"admin-permgroups","exportTrainingResultsExcel":"admin-permgroups","trainingRosterModalClassId":"admin-permgroups","trainingRosterStaged":"admin-permgroups","trainingRosterFilePreviewItems":"admin-permgroups","openTrainingRosterModal":"admin-permgroups","closeTrainingRosterModal":"admin-permgroups","stageTrainingRosterUser":"admin-permgroups","renderTrainingRosterStagedList":"admin-permgroups","removeTrainingRosterStaged":"admin-permgroups","addTrainingRosterPick":"admin-permgroups","onTrainingRosterFileChange":"admin-permgroups","addTrainingRosterFileFound":"admin-permgroups","TRAINING_ROSTER_SKIP_REASON_LABELS":"admin-permgroups","confirmTrainingRosterAdd":"admin-permgroups","tbQuestions":"admin-permgroups","tbAddQuestion":"admin-permgroups","tbRemoveQuestion":"admin-permgroups","tbAddOption":"admin-permgroups","tbRemoveOption":"admin-permgroups","tbUpdateQuestionField":"admin-permgroups","tbSetQuestionText":"admin-permgroups","tbSetQuestionPoints":"admin-permgroups","tbSetOptionText":"admin-permgroups","tbToggleCorrect":"admin-permgroups","renderTestBuilderQuestions":"admin-permgroups","submitTrainingTest":"admin-permgroups","renderTrainingTests":"admin-permgroups","deleteTrainingTest":"admin-permgroups","renderTrainingMyRegs":"admin-permgroups","cancelTrainingRegistrationAction":"admin-permgroups","trainingJoinClassRegId":"admin-permgroups","openTrainingJoinClassModal":"admin-permgroups","closeTrainingJoinClassModal":"admin-permgroups","trainingDocOpenLinkHTML":"admin-permgroups","renderTrainingJoinClassModalBody":"admin-permgroups","markTrainingDocumentViewedAction":"admin-permgroups","ttTakeClassId":"admin-permgroups","ttTakeQuestions":"admin-permgroups","ttTakeAnswers":"admin-permgroups","ttTakeIndex":"admin-permgroups","ttTakeSecondsPerQuestion":"admin-permgroups","ttTakeSecondsLeft":"admin-permgroups","ttTakeTimerHandle":"admin-permgroups","shuffleArrayCopy":"admin-permgroups","openTakeTestModal":"admin-permgroups","ttTakeExit":"admin-permgroups","ttTakeRenderQuestion":"admin-permgroups","ttTakeUpdateTimerDisplay":"admin-permgroups","ttTakeSelectOption":"admin-permgroups","ttTakeToggleOptionFromCheckbox":"admin-permgroups","ttTakeGoNext":"admin-permgroups","ttTakeSubmit":"admin-permgroups","onTrainingDocTypeChange":"admin-permgroups","submitTrainingDocument":"admin-permgroups","trainingYoutubeEmbedUrl":"admin-permgroups","onTrainingDocFilterCategoryChange":"admin-permgroups","renderTrainingDocuments":"admin-permgroups","deleteTrainingDocument":"admin-permgroups","submitCareerPath":"admin-permgroups","computeCareerPathStageStatuses":"admin-permgroups","renderCareerPathStagesHTML":"admin-permgroups","findCareerPathCurrentStage":"admin-permgroups","renderCareerPaths":"admin-permgroups","renderCpEmployeeStageLookup":"admin-permgroups","confirmCareerPathAction":"admin-permgroups","deleteCareerPath":"admin-permgroups","ONBOARDING_STAGE1_DAYS":"admin-permgroups","ONBOARDING_STAGE2_DAYS":"admin-permgroups","ONBOARDING_STAGE3_DAYS":"admin-permgroups","ONBOARDING_DUE_SOON_DAYS":"admin-permgroups","onboardingAddDays":"admin-permgroups","onboardingMilestoneStatus":"admin-permgroups","computeOnboardingMilestones":"admin-permgroups","ONBOARDING_STATUS_BADGE_CLASS":"admin-permgroups","onboardingStageBadgeHTML":"admin-permgroups","editingOnboardingPathId":"admin-permgroups","populateOnboardingPathSelects":"admin-permgroups","submitOnboardingPath":"admin-permgroups","openEditOnboardingPath":"admin-permgroups","cancelEditOnboardingPath":"admin-permgroups","deleteOnboardingPath":"admin-permgroups","renderOnboardingPathsTable":"admin-permgroups","computeOnboardingStageProgress":"admin-permgroups","onboardingStageConfirmCellHTML":"admin-permgroups","onboardingEmployeesCache":"admin-permgroups","populateOnboardingEmployeesDatalist":"admin-permgroups","resolveOnboardingEmployeeInput":"admin-permgroups","submitOnboardingAssignment":"admin-permgroups","deleteOnboardingProgress":"admin-permgroups","confirmOnboardingStageAction":"admin-permgroups","renderOnboardingProgressTable":"admin-permgroups","onboardingStageCoursesHTML":"admin-permgroups","renderMyOnboardingCardHTML":"admin-permgroups","renderMyOnboarding":"admin-permgroups","canEvaluateOnboardingStage3Local":"admin-permgroups","renderOnboardingStage3Queue":"admin-permgroups","submitOnboardingStage3Evaluation":"admin-permgroups","issueOnboardingCertificateAction":"admin-permgroups","ONBOARDING_CERT_PAGE_W":"admin-permgroups","ONBOARDING_CERT_PAGE_H":"admin-permgroups","downloadOnboardingCertificatePdf":"admin-permgroups","renderOnboardingLms":"admin-permgroups","setInternalSubTab":"internalcomms-nhipsong","onInternalFilterChange":"internalcomms-nhipsong","filterInternalByCard":"internalcomms-nhipsong","editingInternalPostId":"internalcomms-nhipsong","submitInternalPost":"internalcomms-nhipsong","canEditInternalPostUI":"internalcomms-nhipsong","editInternalPostUI":"internalcomms-nhipsong","cancelEditInternalPost":"internalcomms-nhipsong","toggleInternalPinDurationWrap":"internalcomms-nhipsong","hideInternalPostAction":"internalcomms-nhipsong","unhideInternalPostAction":"internalcomms-nhipsong","requestInternalPostInfoAction":"internalcomms-nhipsong","canManageRecruitmentLocal":"internalcomms-nhipsong","RECRUITMENT_STATUS_LABELS":"internalcomms-nhipsong","RECRUITMENT_STATUS_COLORS":"internalcomms-nhipsong","RECRUITMENT_JOB_EXPIRING_SOON_DAYS":"internalcomms-nhipsong","isRecruitmentJobExpiringSoon":"internalcomms-nhipsong","recruitmentJobStatusBadgeHTML":"internalcomms-nhipsong","setRecruitmentTab":"internalcomms-nhipsong","renderRecruitment":"internalcomms-nhipsong","submitRecruitmentJob":"internalcomms-nhipsong","populateRecruitmentJobsMonthFilter":"internalcomms-nhipsong","onRecruitmentJobsFilterChange":"internalcomms-nhipsong","renderRecruitmentJobs":"internalcomms-nhipsong","closeRecruitmentJobUi":"internalcomms-nhipsong","confirmRecruitmentJobFilledUi":"internalcomms-nhipsong","deleteRecruitmentJob":"internalcomms-nhipsong","openRecruitmentReferModal":"internalcomms-nhipsong","closeRecruitmentReferModal":"internalcomms-nhipsong","submitRecruitmentReferral":"internalcomms-nhipsong","renderRecruitmentMyReferrals":"internalcomms-nhipsong","populateRecruitmentManageFilter":"internalcomms-nhipsong","onRecruitmentManageFilterChange":"internalcomms-nhipsong","renderRecruitmentManage":"internalcomms-nhipsong","setRecruitmentReferralStatusUi":"internalcomms-nhipsong","isInternalImageAttachment":"internalcomms-nhipsong","internalNewsSortMode":"internalcomms-nhipsong","setInternalNewsSort":"internalcomms-nhipsong","internalPostStatusBadgeHTML":"internalcomms-nhipsong","internalPostEditButtonHTML":"internalcomms-nhipsong","internalPostInfoRequestBannerHTML":"internalcomms-nhipsong","internalPostHideActionHTML":"internalcomms-nhipsong","internalPostRequestInfoActionHTML":"internalcomms-nhipsong","expandedInternalComments":"internalcomms-nhipsong","toggleInternalCommentsExpanded":"internalcomms-nhipsong","toggleInternalCommentsExpandedAndView":"internalcomms-nhipsong","focusInternalCommentInput":"internalcomms-nhipsong","toggleInternalCommentLike":"internalcomms-nhipsong","internalCommentLikeButtonHTML":"internalcomms-nhipsong","pickHighlightedComments":"internalcomms-nhipsong","renderInternalModerationQueueHTML":"internalcomms-nhipsong","renderInternalPosts":"internalcomms-nhipsong","renderInternalNewsFeed":"internalcomms-nhipsong","renderInternalNewsCard":"internalcomms-nhipsong","toggleInternalLikeInline":"internalcomms-nhipsong","addInternalCommentInline":"internalcomms-nhipsong","dismissCommentFlagAction":"internalcomms-nhipsong","deleteFlaggedCommentAction":"internalcomms-nhipsong","closeInternalArticleModal":"internalcomms-nhipsong","viewInternalPostDetail":"internalcomms-nhipsong","markInternalRead":"internalcomms-nhipsong","toggleInternalLike":"internalcomms-nhipsong","addInternalComment":"internalcomms-nhipsong","registerForTraining":"internalcomms-nhipsong","unregisterFromTraining":"internalcomms-nhipsong","approveInternalPostAction":"internalcomms-nhipsong","rejectInternalPostAction":"internalcomms-nhipsong","activeItSupportSubTab":"itsupport-price","setItSupportSubTab":"itsupport-price","itPricePendingFile":"itsupport-price","itPriceCellHTML":"itsupport-price","renderItPriceFilePreview":"itsupport-price","parseItPriceFileForPreview":"itsupport-price","onItPriceFileChange":"itsupport-price","onItPriceMasterListChange":"itsupport-price","updateItPriceMasterListDownloadLink":"itsupport-price","colRoleModalState":"itsupport-price","openColumnRoleMappingModal":"itsupport-price","closeColRoleModal":"itsupport-price","confirmColRoleModal":"itsupport-price","renderItPriceMasterListAdmin":"itsupport-price","pickAndParseMasterListFile":"itsupport-price","itPriceColumnListText":"itsupport-price","addItPriceMasterList":"itsupport-price","replaceItPriceMasterListFile":"itsupport-price","renameItPriceMasterList":"itsupport-price","deleteItPriceMasterList":"itsupport-price","renderItPriceMasterListSelect":"itsupport-price","submitItPriceApproval":"itsupport-price","onItPriceFilterChange":"itsupport-price","filterItPriceByCard":"itsupport-price","activeItPriceSubTab":"itsupport-price","setItPriceSubTab":"itsupport-price","resolveApprovedFileIdClient":"itsupport-price","resolveApprovedFileUrlClient":"itsupport-price","canViewItPriceApproval":"itsupport-price","itPriceStatusBadge":"itsupport-price","itPriceAppliedBadge":"itsupport-price","renderItPriceApprovals":"itsupport-price","approveItPrice":"itsupport-price","approveItPriceConfirmed":"itsupport-price","rejectItPrice":"itsupport-price","claimPriceApplyAction":"itsupport-price","releasePriceApplyClaimAction":"itsupport-price","applyItPriceAction":"itsupport-price","deleteItPriceAction":"itsupport-price","diffPriceFileItems":"itsupport-price","itPriceMasterListDownloadLinkHTML":"itsupport-price","viewItPriceExtraFile":"itsupport-price","currentItPriceModalId":"itsupport-price","openItPriceModal":"itsupport-price","closeItPriceModal":"itsupport-price","renderItPriceModal":"itsupport-price","toggleItPriceMarkColsBox":"itsupport-price","onItPriceMarkColToggle":"itsupport-price","downloadItPriceMarkedFile":"itsupport-price","renderItPriceModalControls":"itsupport-price","requestItPriceInfoApprover":"itsupport-price","requestItPriceEmergencyRejectAction":"itsupport-price","approveItPriceEmergencyRejectAction":"itsupport-price","denyItPriceEmergencyRejectAction":"itsupport-price","requestItPriceInfoIt":"itsupport-price","itPriceSupplementPendingFile":"itsupport-price","onItPriceSupplementFileChange":"itsupport-price","submitItPriceSupplementAction":"itsupport-price","IT_TICKET_CATEGORY_LABELS_DEFAULT":"itsupport-price","IT_TICKET_STATUS_BADGES":"itsupport-price","submitItTicket":"itsupport-price","onItTicketFilterChange":"itsupport-price","canViewItTicket":"itsupport-price","renderItTickets":"itsupport-price","runItTicketAction":"itsupport-price","deleteItTicketAction":"itsupport-price","currentItTicketModalId":"itsupport-price","showItTicketEscalateForm":"itsupport-price","openItTicketEscalateForm":"itsupport-price","closeItTicketEscalateForm":"itsupport-price","IT_TICKET_APPROVAL_BADGES":"itsupport-price","openItTicketModal":"itsupport-price","renderItTicketModal":"itsupport-price","closeItTicketModal":"itsupport-price","claimItTicketAction":"itsupport-price","escalateItTicketAction":"itsupport-price","approveItTicketEscalationAction":"itsupport-price","denyItTicketEscalationAction":"itsupport-price","updateItTicketStatusAction":"itsupport-price","cancelItTicketAction":"itsupport-price","submitItTicketComment":"itsupport-price","IT_RENEWAL_CATEGORY_SUGGESTIONS":"itsupport-renewal","computeItRenewalLifecycleState":"itsupport-renewal","IT_RENEWAL_LIFECYCLE_LABELS":"itsupport-renewal","filterItServiceRenewalByCard":"itsupport-renewal","onItServiceRenewalFilterChange":"itsupport-renewal","renderItServiceRenewals":"itsupport-renewal","buildItServiceRenewalRowHTML":"itsupport-renewal","runItServiceRenewalAction":"itsupport-renewal","submitItServiceRenewal":"itsupport-renewal","downloadItServiceRenewalFile":"itsupport-renewal","deleteItServiceRenewalAction":"itsupport-renewal","openItServiceRenewalRenewModal":"itsupport-renewal","closeItServiceRenewalRenewModal":"itsupport-renewal","submitItServiceRenewalRenew":"itsupport-renewal","openItServiceRenewalEditModal":"itsupport-renewal","closeItServiceRenewalEditModal":"itsupport-renewal","submitItServiceRenewalEdit":"itsupport-renewal","renderItPriceTierWorkflowTab":"itsupport-tier","onItPriceTierWorkflowTemplateChange":"itsupport-tier","collectItPriceTierWorkflowConfig":"itsupport-tier","saveItPriceTierWorkflowConfig":"itsupport-tier","collectDeptWorkflowConfig":"itsupport-tier","writeDeptWorkflowConfig":"itsupport-tier","saveDeptWorkflowConfig":"itsupport-tier","saveAllDeptWorkflowConfigs":"itsupport-tier","renderWorkflowTemplatesTable":"itsupport-tier","addStepRow":"itsupport-tier","removeStepRow":"itsupport-tier","reindexStepRows":"itsupport-tier","resetWorkflowForm":"itsupport-tier","saveWorkflowTemplate":"itsupport-tier","editWorkflowTemplate":"itsupport-tier","deleteWorkflowTemplate":"itsupport-tier","populateLogFilterSelect":"logsystem-trash","onLogFilterChange":"logsystem-trash","getFilteredSystemLogs":"logsystem-trash","TRASH_COLLECTION_LABELS":"logsystem-trash","trashCollectionLabel":"logsystem-trash","trashItemLabel":"logsystem-trash","trashItemsCache":"logsystem-trash","loadTrashItems":"logsystem-trash","renderTrashList":"logsystem-trash","restoreTrashItem":"logsystem-trash","permanentlyDeleteTrashItemUI":"logsystem-trash","permanentlyDeleteTrashItemConfirmed":"logsystem-trash","loadSystemLogs":"logsystem-trash","renderSystemLogs":"logsystem-trash","clearSystemLogs":"logsystem-trash","exportSystemLogsExcel":"logsystem-trash","resetLogFilters":"logsystem-trash","activeBudgetSubTab":"itsupport-tier","bId":"itsupport-tier","bEl":"itsupport-tier","budgetEntryFormDraftId":"itsupport-tier","budgetEntryFormLines":"itsupport-tier","budgetManagerEditEntryId":"itsupport-tier","budgetManagerEditLines":"itsupport-tier","budgetManagerEditFields":"itsupport-tier","editingBudgetTemplateId":"itsupport-tier","budgetTemplateFormFields":"itsupport-tier","currentProcessingBudgetEntryId":"itsupport-tier","currentBudgetSummaryData":"itsupport-tier","BUDGET_FIELD_TYPE_LABELS":"itsupport-tier","BUDGET_CORE_FIELD_DEFS":"itsupport-tier","BUDGET_CORE_ORDER_DEFAULT":"itsupport-tier","defaultBudgetFields":"itsupport-tier","canManageBudgetClient":"itsupport-tier","canCreateBudgetEntryClient":"itsupport-tier","canAggregateBudgetClient":"itsupport-tier","budgetPeriodIsOpen":"itsupport-tier","budgetPeriodIsClosed":"itsupport-tier","budgetPeriodDeptAllowed":"itsupport-tier","setBudgetSubTab":"itsupport-tier","renderBudgetEntrySubTab":"itsupport-tier","getOpenBudgetPeriodsForDept":"itsupport-tier","renderBudgetEntryPeriodOptions":"itsupport-tier","normalizeBudgetTemplateFieldsForDisplay":"itsupport-tier","getBudgetPeriodTemplateFields":"itsupport-tier","getBudgetLineFieldValue":"itsupport-tier","blankBudgetLine":"itsupport-tier","onBudgetEntryPeriodChange":"itsupport-tier","buildBudgetLinesTableHead":"itsupport-tier","formatBudgetFieldDisplayValue":"itsupport-tier","buildBudgetFieldInputHTML":"itsupport-tier","buildBudgetLineRowHTML":"itsupport-tier","renderBudgetEntryLinesTable":"itsupport-tier","collectBudgetEntryLinesFromForm":"itsupport-tier","addBudgetEntryLine":"itsupport-tier","removeBudgetEntryLine":"itsupport-tier","updateBudgetEntryTotalDisplay":"itsupport-tier","saveBudgetEntryDraft":"itsupport-tier","submitCurrentBudgetEntry":"itsupport-tier","generateBudgetEntryCode":"itsupport-tier","budgetEntryStatusBadge":"itsupport-tier","budgetEntryTotal":"itsupport-tier","filterBudgetByCard":"itsupport-tier","filterBudgetByCardPLAN":"itsupport-tier","filterBudgetByCardACTUAL":"itsupport-tier","renderBudgetEntryList":"itsupport-tier","runBudgetEntryListAction":"itsupport-tier","deleteBudgetEntryAction":"itsupport-tier","editBudgetEntryDraft":"itsupport-tier","openBudgetManagerEditModal":"itsupport-tier","budgetEntryStatusBadgeText":"itsupport-tier","closeBudgetManagerEditModal":"itsupport-tier","buildBudgetManagerEditLineRowHTML":"itsupport-tier","renderBudgetManagerEditLinesTable":"itsupport-tier","collectBudgetManagerEditLinesFromForm":"itsupport-tier","addBudgetManagerEditLine":"itsupport-tier","removeBudgetManagerEditLine":"itsupport-tier","updateBudgetManagerEditTotalDisplay":"itsupport-tier","saveBudgetManagerEditEntry":"itsupport-tier","openBudgetPeriodTemplateModal":"itsupport-tier","closeBudgetPeriodTemplateModal":"itsupport-tier","renderBudgetPeriodSubTab":"itsupport-tier","renderBudgetPeriodDeptChecklist":"itsupport-tier","renderBudgetPeriodTemplateOptions":"itsupport-tier","createBudgetPeriod":"itsupport-tier","budgetPeriodDeptLabel":"itsupport-tier","budgetPeriodStatusBadge":"itsupport-tier","renderBudgetPeriodList":"itsupport-tier","runBudgetPeriodAction":"itsupport-tier","closeBudgetPeriodAction":"itsupport-tier","reopenBudgetPeriodAction":"itsupport-tier","deleteBudgetPeriodAction":"itsupport-tier","renderBudgetTemplateList":"itsupport-tier","runBudgetTemplateAction":"itsupport-tier","startNewBudgetTemplate":"itsupport-tier","editBudgetTemplateAction":"itsupport-tier","cancelBudgetTemplateForm":"itsupport-tier","renderBudgetTemplateFieldsBuilder":"itsupport-tier","moveBudgetTemplateField":"itsupport-tier","addBudgetTemplateField":"itsupport-tier","removeBudgetTemplateField":"itsupport-tier","updateBudgetTemplateField":"itsupport-tier","updateBudgetTemplateFieldRequiredFromCheckbox":"itsupport-tier","uploadBudgetTemplateFieldsXlsx":"itsupport-tier","createBudgetTemplateFromRealFile":"itsupport-tier","saveBudgetTemplate":"itsupport-tier","deleteBudgetTemplateAction":"itsupport-tier","renderBudgetSummarySubTab":"itsupport-tier","renderBudgetSummaryPeriodOptions":"itsupport-tier","buildBudgetSummary":"itsupport-tier","budgetTypeTotal":"itsupport-tier","sumEntriesByDept":"itsupport-tier","renderBudgetSummaryResult":"itsupport-tier","exportBudgetSummaryExcel":"itsupport-tier","BUDGET_PDF_PAGE_W":"itsupport-tier","BUDGET_PDF_PAGE_H":"itsupport-tier","BUDGET_PDF_MARGIN":"itsupport-tier","BUDGET_PDF_CAPTURE_SCALE":"itsupport-tier","exportBudgetSummaryPdf":"itsupport-tier","printBudgetSummary":"itsupport-tier","openBudgetProcessModal":"itsupport-tier","closeBudgetProcessModal":"itsupport-tier","confirmProcessBudgetEntry":"itsupport-tier","processBudgetEntry":"itsupport-tier","getWfModuleTypes":"itsupport-tier","switchWfModule":"itsupport-tier","renderWfSubmissionTypeTabs":"itsupport-tier","switchWfSubmissionType":"itsupport-tier","getApproverCandidateUsers":"itsupport-tier","toggleWfOtherDeptCandidates":"itsupport-tier","onWorkflowTemplateChange":"itsupport-tier","renderWorkflowTab":"itsupport-tier","addOfficeItemRow":"hopdong","removeOfficeItemRow":"hopdong","updateOfficeItemField":"hopdong","recalcOfficeItemsTotal":"hopdong","renderOfficeItemsTable":"hopdong","submitOfficeReq":"hopdong","onOfficeFilterChange":"hopdong","filterOfficeByCard":"hopdong","renderOfficeReqs":"hopdong","runOfficeAction":"hopdong","deleteOfficeReqAction":"hopdong","openOfficeProcessModal":"hopdong","closeOfficeProcessModal":"hopdong","confirmProcessOfficeReq":"hopdong","processOfficeReq":"hopdong","findMeetingConflict":"phonghop","toDatetimeLocalValue":"phonghop","generateMeetingTimeSlots":"phonghop","setMeetingSubTab":"phonghop","meetingCalCurrentDate":"phonghop","meetingCalSlots":"phonghop","meetingCalDrag":"phonghop","meetingCalLastClickedSlot":"phonghop","renderMeetingCalendar":"phonghop","wireMeetingCalendarSelection":"phonghop","highlightMeetingDragRange":"phonghop","handleMeetingSingleSlotClick":"phonghop","showMeetingSlotInfo":"phonghop","quickBookMeetingSlot":"phonghop","finalizeMeetingSlotSelection":"phonghop","submitMeetingReq":"phonghop","onMeetingFilterChange":"phonghop","filterMeetingByCard":"phonghop","renderMeetings":"phonghop","runMeetingAction":"phonghop","approveMeeting":"phonghop","cancelMeeting":"phonghop","filterDocByCard":"formbuilder-nav","onFilterChange":"formbuilder-nav","DEPT_ABBR_STOPWORDS":"formbuilder-nav","deriveAbbr":"formbuilder-nav","getDeptAbbr":"formbuilder-nav","getDocCatAbbr":"formbuilder-nav","computeNextDocSeq":"formbuilder-nav","generateDocCode":"formbuilder-nav","getContractTypeAbbr":"formbuilder-nav","computeNextContractSeq":"formbuilder-nav","generateContractCode":"formbuilder-nav","computeNextAddendumSeq":"formbuilder-nav","generateAddendumCode":"formbuilder-nav","todayCodeDatePart":"formbuilder-nav","computeNextHcrcSeq":"formbuilder-nav","generateHcrcCode":"formbuilder-nav","generateSubCode":"formbuilder-nav","generateCarCode":"formbuilder-nav","generateOfficeCode":"formbuilder-nav","generateMinutesCode":"formbuilder-nav","generateMeetingCode":"formbuilder-nav","generateItPriceCode":"formbuilder-nav","generateItTicketCode":"formbuilder-nav","computeNextWfSeq":"formbuilder-nav","generateWfCode":"formbuilder-nav","getDocFamily":"formbuilder-nav","getDocFamilyLatest":"formbuilder-nav","isDocFamilyLatestBlocking":"formbuilder-nav","onDocOpModeChange":"formbuilder-nav","refreshDocCodePreview":"formbuilder-nav","populateDocUpdateTargets":"formbuilder-nav","onDocUpdateTargetChange":"formbuilder-nav","renderDocs":"formbuilder-nav","toggleDocFamily":"formbuilder-nav","buildDocRowHTML":"formbuilder-nav","runDocAction":"formbuilder-nav","deleteDocAction":"formbuilder-nav","downloadDocFile":"formbuilder-nav","uploadDoc":"formbuilder-nav","onLicenseOpModeChange":"formbuilder-nav","getLicenseFamily":"formbuilder-nav","getLicenseFamilyLatest":"formbuilder-nav","isLicenseFamilyLatestBlocking":"formbuilder-nav","populateLicenseUpdateTargets":"formbuilder-nav","onLicenseUpdateTargetChange":"formbuilder-nav","computeLicenseLifecycleState":"formbuilder-nav","LICENSE_LIFECYCLE_LABELS":"formbuilder-nav","filterLicenseByCard":"formbuilder-nav","onLicenseFilterChange":"formbuilder-nav","renderLicenses":"formbuilder-nav","toggleLicenseFamily":"formbuilder-nav","buildLicenseRowHTML":"formbuilder-nav","runLicenseAction":"formbuilder-nav","approveLicenseAction":"formbuilder-nav","rejectLicenseAction":"formbuilder-nav","setLicenseRenewingAction":"formbuilder-nav","revokeLicenseAction":"formbuilder-nav","unrevokeLicenseAction":"formbuilder-nav","deleteLicenseAction":"formbuilder-nav","downloadLicenseFile":"formbuilder-nav","viewLicenseFile":"formbuilder-nav","viewLicenseDetails":"formbuilder-nav","closeLicenseDetailModal":"formbuilder-nav","uploadLicense":"formbuilder-nav","saveLicenseType":"formbuilder-nav","deleteLicenseType":"formbuilder-nav","renderLicenseTypeList":"formbuilder-nav","uploadFileToServer":"formbuilder-nav","UPLOAD_MODULE_KEY_MAP":"formbuilder-nav","mapFormModKeyToUploadModule":"formbuilder-nav","UPLOAD_EXT_UNIVERSE":"formbuilder-nav","UPLOAD_MODULE_LIST":"formbuilder-nav","renderUploadTypeConfig":"formbuilder-nav","updateUploadSizeLimit":"formbuilder-nav","toggleUploadTypeExt":"formbuilder-nav","toggleUploadTypeExtFromCheckbox":"formbuilder-nav","approveDoc":"formbuilder-nav","approveDocConfirmed":"formbuilder-nav","rejectDoc":"formbuilder-nav","getFileKind":"formbuilder-nav","PROTECTED_VIEW_WATERMARK_COMPANY":"formbuilder-nav","PROTECTED_VIEW_WATERMARK_STYLE":"formbuilder-nav","attachmentDownloadUrl":"formbuilder-nav","buildProtectedViewerHTML":"formbuilder-nav","openFileProtectedView":"formbuilder-nav","viewDoc":"formbuilder-nav","closeViewDocModal":"formbuilder-nav","viewDocDetails":"formbuilder-nav","closeDocDetailModal":"formbuilder-nav","printViewModalContent":"formbuilder-nav","printHtmlViaHiddenIframe":"formbuilder-nav","editingPaymentRequestId":"hopdong","setPaymentSubTab":"hopdong","renderPaymentCreateInstallmentsList":"hopdong","addPaymentCreateInstallmentRow":"hopdong","removePaymentCreateInstallmentRow":"hopdong","collectPaymentCreateInstallments":"hopdong","updatePaymentCreateInstallmentsSummary":"hopdong","populatePaymentSourceRecordOptions":"hopdong","computeSourcePaymentInstallmentsPreview":"hopdong","onPaymentSourceTypeChange":"hopdong","onPaymentSourceRecordChange":"hopdong","submitManualPaymentRequest":"hopdong","cancelEditPaymentRequest":"hopdong","openEditPaymentRequest":"hopdong","PAYMENT_STATUS_LABELS":"hopdong","PAYMENT_STATUS_BADGE_CLS":"hopdong","PAYMENT_SOURCE_LABELS":"hopdong","onPaymentFilterChange":"hopdong","filterPaymentByCard":"hopdong","renderPaymentRequests":"hopdong","approvePaymentRequestAction":"hopdong","requestPaymentInfoAction":"hopdong","deletePaymentRequestAction":"hopdong","confirmPaymentInstallmentAction":"hopdong","viewContractDetails":"hopdong","viewContract":"hopdong","viewContractSignedFile":"hopdong","submitSubmissionReq":"vanbantrinh","doSubmitSubmissionReq":"vanbantrinh","renderSubmissionApprovalLayerCheckboxes":"vanbantrinh","toggleSubApprovalDropdown":"vanbantrinh","updateSubApprovalDropdownLabel":"vanbantrinh","onSubApprovalLayerToggle":"vanbantrinh","renderContractApprovalLayerCheckboxes":"vanbantrinh","toggleContractApprovalDropdown":"vanbantrinh","updateContractApprovalDropdownLabel":"vanbantrinh","onContractApprovalLayerToggle":"vanbantrinh","previewContractApprovalWorkflow":"vanbantrinh","onSubFilterChange":"vanbantrinh","filterSubByCard":"vanbantrinh","renderSubmissionReqs":"vanbantrinh","runSubmissionAction":"vanbantrinh","deleteSubmissionAction":"vanbantrinh","downloadAllSubmissionFiles":"vanbantrinh","openProcessSubmissionModal":"vanbantrinh","openTroLyThuKyBoSungChoice":"vanbantrinh","openTroLyThuKyProposeFileForm":"vanbantrinh","confirmTroLyThuKyProposeFile":"vanbantrinh","openResolveFileProposalModal":"vanbantrinh","viewFileProposalAttachment":"vanbantrinh","confirmResolveFileProposalAgree":"vanbantrinh","confirmResolveFileProposalDisagree":"vanbantrinh","confirmResolveFileProposal":"vanbantrinh","currentStepApproversFor":"vanbantrinh","closeProcessSubmissionModal":"vanbantrinh","confirmProcessSubmission":"vanbantrinh","processSubmission":"vanbantrinh","renderSubModalOpinions":"vanbantrinh","renderSubModalOpinionWarning":"vanbantrinh","giveSubmissionOpinion":"vanbantrinh","buildSubmissionApprovalSlipHTML":"vanbantrinh","viewSubmissionAttachment":"vanbantrinh","viewSubmissionExtraFile":"vanbantrinh","viewSubmissionApprovalSlip":"vanbantrinh","downloadSubmissionApprovalSlip":"vanbantrinh","buildEffectiveSubmissionWorkflow":"vanbantrinh","buildSubmissionWorkflowPreviewHTML":"vanbantrinh","readSelectedSubmissionLayers":"vanbantrinh","previewSubmissionWorkflow":"vanbantrinh","OPERATION_KIND_META":"vanhanh","activeVanHanhSubTab":"vanhanh","VAN_HANH_SUBTAB_TO_KIND":"vanhanh","setVanHanhSubTab":"vanhanh","setOperationStoreSubTab":"vanhanh","operationStatusBadge":"vanhanh","OPERATION_STAGE_LABELS":"vanhanh","computeOperationRecordStageStatusClient":"vanhanh","operationRecordStageStatus":"vanhanh","OPERATION_STAGE_BADGE_CLASS":"vanhanh","operationStageBadge":"vanhanh","canCreateOperationOrderClient":"vanhanh","canCreateOperationStoreOpeningClient":"vanhanh","canCreateOperationRepairClient":"vanhanh","resolveVsoPersonInChargeInput":"vanhanh","resolveVrPersonInChargeInput":"vanhanh","operationOrderItems":"vanhanh","addOperationOrderItemRow":"vanhanh","removeOperationOrderItemRow":"vanhanh","updateOperationOrderItemField":"vanhanh","recalcOperationOrderItemsTotal":"vanhanh","renderOperationOrderItemsTable":"vanhanh","generateOperationOrderCode":"vanhanh","generateOperationStoreOpenCode":"vanhanh","generateOperationRepairCode":"vanhanh","submitOperationOrder":"vanhanh","submitOperationStoreOpening":"vanhanh","submitOperationRepair":"vanhanh","notifyOperationApprovalNeeded":"vanhanh","onOperationOrderFilterChange":"vanhanh","onOperationStoreOpenFilterChange":"vanhanh","onOperationRepairFilterChange":"vanhanh","filterOperationOrderByCard":"vanhanh","filterOperationStoreOpenByCard":"vanhanh","filterOperationRepairByCard":"vanhanh","OPERATION_FILTER_PREFIX":"vanhanh","OPERATION_STORE_OR_REPAIR":"vanhanh","renderOperationList":"vanhanh","renderOperationOrderList":"vanhanh","renderOperationStoreOpeningList":"vanhanh","renderOperationRepairList":"vanhanh","buildOperationRowHTML":"vanhanh","runOperationAction":"vanhanh","runOperationOrderAction":"vanhanh","runOperationStoreOpenAction":"vanhanh","runOperationRepairAction":"vanhanh","deleteOperationAction":"vanhanh","currentProcessingOperationKind":"vanhanh","currentProcessingOperationId":"vanhanh","buildOperationDetailsHTML":"vanhanh","viewOperationAttachment":"vanhanh","openOperationProcessModal":"vanhanh","closeOperationProcessModal":"vanhanh","confirmProcessOperation":"vanhanh","processOperation":"vanhanh","OPERATION_ESTIMATE_MODULE_KEY":"vanhanh","operationEstimateWfMap":"vanhanh","canCreateOperationEstimateClient":"vanhanh","operationEstimateStatusBadge":"vanhanh","renderOperationEstimateList":"vanhanh","operationEstimateItems":"vanhanh","currentEstimateKind":"vanhanh","currentEstimateRecordId":"vanhanh","currentEstimateBudget":"vanhanh","currentEstimateBudgetMissing":"vanhanh","addOperationEstimateItemRow":"vanhanh","removeOperationEstimateItemRow":"vanhanh","updateOperationEstimateItemField":"vanhanh","recalcOperationEstimateItemsTotal":"vanhanh","renderOperationEstimateItemsTable":"vanhanh","openOperationEstimateModal":"vanhanh","closeOperationEstimateModal":"vanhanh","submitOperationEstimateForApproval":"vanhanh","exportOperationEstimateItems":"vanhanh","onOperationEstimateImportFileChange":"vanhanh","resetOperationEstimateToDraft":"vanhanh","confirmProcessOperationEstimate":"vanhanh","processOperationEstimate":"vanhanh","operationSourceType":"vanhanh","getOperationWorkItemsForRecord":"vanhanh","getOperationExecutionPeriodsForRecord":"vanhanh","operationWorkItemStatusBadge":"vanhanh","operationComputeParentWorkItemStatus":"vanhanh","syncOperationWorkItemAncestorsClient":"vanhanh","operationExecutionEligibleRows":"vanhanh","operationWorkItemProgressSummary":"vanhanh","renderOperationExecutionList":"vanhanh","renderOperationAcceptanceList":"vanhanh","currentWorkItemModalKind":"vanhanh","currentWorkItemModalRecordId":"vanhanh","currentWorkItemModalMode":"vanhanh","currentWorkItemFormParentId":"vanhanh","currentEditWorkItemId":"vanhanh","openOperationWorkItemModal":"vanhanh","closeOperationWorkItemModal":"vanhanh","renderOperationWorkItemModalBody":"vanhanh","confirmOperationUseAction":"vanhanh","buildOperationWorkItemRows":"vanhanh","computeOperationWorkItemExpectedAcceptanceDate":"vanhanh","buildOperationWorkItemRow":"vanhanh","openOperationWorkItemFormModal":"vanhanh","onOwiAcceptanceModeChange":"vanhanh","closeOperationWorkItemFormModal":"vanhanh","openOperationWorkItemEditModal":"vanhanh","resolveOwiAcceptorInput":"vanhanh","submitOperationWorkItemForm":"vanhanh","exportOperationWorkItems":"vanhanh","OPERATION_WORK_ITEM_STATUS_LABELS":"vanhanh","onOperationWorkItemImportFileChange":"vanhanh","updateOperationWorkItemProgressAction":"vanhanh","currentOwiProgressItemId":"vanhanh","OPERATION_WORK_ITEM_NEXT_STATUS_LABEL":"vanhanh","openOperationWorkItemProgressModal":"vanhanh","closeOperationWorkItemProgressModal":"vanhanh","confirmOperationWorkItemProgress":"vanhanh","currentAcceptanceActionItemId":"vanhanh","currentAcceptanceActionType":"vanhanh","openOperationAcceptanceActionModal":"vanhanh","closeOperationAcceptanceActionModal":"vanhanh","confirmOperationAcceptanceAction":"vanhanh","renderOperationStoreReport":"vanhanh","OP_CLICK_ACTIONS":"vanhanh","OP_CHANGE_ACTIONS":"vanhanh","OP_INPUT_ACTIONS":"vanhanh","OP_SUBMIT_ACTIONS":"vanhanh","bindOperationDelegation":"vanhanh","canManageVpp":"vpp","vppCalcItemsTotal":"vpp","vppActiveHeadcountForDept":"vpp","renderVppDeptHeadcountTable":"vpp","onVppBudgetInput":"vpp","onVppHeadcountInput":"vpp","collectVppDeptHeadcounts":"vpp","vppPeriodIsOpen":"vpp","setVppSubTab":"vpp","renderVppRegPeriodOptions":"vpp","vppStripAccents":"vpp","findOwnVppRegForPeriod":"vpp","onVppRegPeriodChange":"vpp","filterVppRegItemsTable":"vpp","collectVppRegFormItems":"vpp","updateVppRegTotalDisplay":"vpp","saveVppRegDraft":"vpp","submitVppRegDraftAction":"vpp","vppRegStatusBadge":"vpp","onVppFilterChange":"vpp","filterVppByCard":"vpp","renderVppRegistrations":"vpp","editVppRegDraft":"vpp","runVppRegAction":"vpp","deleteVppRegAction":"vpp","openVppRegModal":"vpp","closeVppRegModal":"vpp","confirmProcessVppReg":"vpp","processVppReg":"vpp","vppPendingCatalog":"vpp","onVppCatalogFileChange":"vpp","createVppPeriod":"vpp","vppPeriodStatusBadge":"vpp","renderVppPeriods":"vpp","runVppPeriodAction":"vpp","closeVppPeriodAction":"vpp","deleteVppPeriodAction":"vpp","downloadVppExport":"vpp","renderVppReportPeriodOptions":"vpp","renderVppReports":"vpp","buildOfficeApprovalSlipHTML":"vpp","viewOfficeApprovalSlip":"vpp","viewOfficeSignedFile":"vpp","downloadOfficeApprovalSlip":"vpp","WF_MODULE_CONFIG":"workflow"};

// TAB_MODULE_GROUPS: tabName (switchTab()) -> cac cum PHAI nap TRUOC KHI goi ham render/setXSubTab
// tuong ung cua tab do (chi liet ke cum THAM CHIEU TRUC TIEP - loadModuleGroup() tu lo phan deps
// bac cao hon). Tab khong co trong bang (approvalHub/dashboard) khong can nap gi them.
const TAB_MODULE_GROUPS = {"approvalHub":[],"doc":["formbuilder-nav"],"task":["congviec"],"internal":["internalcomms-nhipsong"],"submission":["formbuilder-nav","vanbantrinh"],"contract":["hopdong"],"meeting":["formbuilder-nav","phonghop"],"minutes":["bienbanhop","formbuilder-nav"],"car":["dangkyxe"],"vpp":["vpp"],"uniform":["dongphuc"],"license":["formbuilder-nav"],"periodicReport":["baocaodinhky-nhap"],"office":["hopdong"],"reports":["baocaoquantri-preview"],"hr":["hcrcdonghanh"],"orgChart":["hcrcdonghanh"],"budget":["itsupport-tier"],"vanHanh":["vanhanh"],"dashboard":[],"system":["hethong-tabs"],"itSupport":["itsupport-price"]};

const _loadedModuleGroups = {}; // groupKey -> Promise (cache, dam bao idempotent - goi lai khong nap lai)
// _settledModuleGroups: groupKey da THUC SU nap xong (Promise cua no đa resolve), khong chi "da bat dau
// nap". Dung de kiem tra DONG BO (khong qua await/microtask nao) xem 1 tabName da san sang hay chua —
// xem switchTab() ben duoi: neu san sang, goi thang render dong bo (KHONG lui 1 nhip vi mo nao ca, giu
// nguyen hanh vi dong bo y het truoc khi co Ha tang nap cum) thay vi luon await loadTabModuleGroups().
const _settledModuleGroups = new Set();

function _loadModuleScriptTag(fileName) {
  return new Promise((resolve, reject) => {
    const v = window.__ASSET_VERSION__ ? ("?v=" + encodeURIComponent(window.__ASSET_VERSION__)) : "";
    const s = document.createElement("script");
    // script.async = false: 1 the <script> TAO/CHEN DONG (document.createElement + appendChild) mac dinh
    // chay o che do "async" NGAM (dung nhu <script async>) - moi file TAI XONG la THUC THI NGAY, KHONG
    // theo dung thu tu da chen, du fetch/tai xong o thu tu nao. Vai file module-*.js CUNG 1 cum co tham
    // chieu bare-identifier (khong phai goi ham, chi la GAN GIA TRI, vd 1 object cau hinh top-level gan
    // thang 1 ham cua file khac lam field) o cap TOP LEVEL (khong nam trong than ham nao) - loai tham
    // chieu nay CAN dung thu tu thuc thi giua cac file trong CUNG 1 cum (khac voi goi HAM, von an toan du
    // thu tu nao vi luon duoc goi SAU, o thoi diem da nap het). Dat async=false phuc hoi dung hanh vi
    // "thuc thi theo THU TU CHEN vao DOM" (giong het cach <script> tinh cu trong index.html tung chay) -
    // xem MODULE_LOAD_GROUPS.<key>.files da duoc sap theo DUNG thu tu khoi script GOC (khong phai bang
    // chu cai) o dau file nay, phat hien qua bo test hoi quy (renderOfficeReportExtra is not defined).
    s.async = false;
    s.src = "/js/" + fileName + v;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Khong tai duoc mo-dun " + fileName));
    document.head.appendChild(s);
  });
}

// Nap 1 cum module-*.js (dung script tag dong, giu nguyen cache-busting ?v= cua Phan A) - tu dong
// nap TRUOC/CUNG LUC moi cum khac ma cum nay phu thuoc (groups[key].deps, tinh de quy). Idempotent:
// goi lai voi cung key tra ve DUNG promise cu (khong chen lai <script>, khong tai lai qua mang).
// Loi mang/404 xoa cache de lan goi SAU co the thu lai (khong ket qua that bai vinh vien).
function loadModuleGroup(key) {
  if (_loadedModuleGroups[key]) return _loadedModuleGroups[key];
  const grp = MODULE_LOAD_GROUPS[key];
  if (!grp) return Promise.reject(new Error("Khong ro nhom module: " + key));
  const p = Promise.all([
    Promise.all((grp.deps || []).map(loadModuleGroup)),
    Promise.all(grp.files.map(_loadModuleScriptTag))
  ]).then(() => { _settledModuleGroups.add(key); });
  _loadedModuleGroups[key] = p;
  p.catch(() => { delete _loadedModuleGroups[key]; });
  return p;
}

// true neu TAT CA cum can cho tabName đa nap xong THUC SU (khong chi dang nap dang bat dau) — cho phep
// switchTab() goi render dong bo, khong lui nhip nao, khi tab da tung mo truoc do trong phien.
function isTabModuleGroupsSettled(tabName) {
  const keys = TAB_MODULE_GROUPS[tabName];
  return !keys || keys.every(k => _settledModuleGroups.has(k));
}

// Nap tat ca cum can cho 1 tabName (TAB_MODULE_GROUPS[tabName], neu co) - dung o switchTab().
function loadTabModuleGroups(tabName) {
  const keys = TAB_MODULE_GROUPS[tabName];
  if (!keys || !keys.length) return Promise.resolve();
  return Promise.all(keys.map(loadModuleGroup)).then(() => {});
}

// Dam bao 1 ham toan cuc (goi qua TEN CHUOI - cspDispatchOp()/window[fnName]()) da san sang truoc
// khi goi that - neu chua co (chua nap file dinh nghia no), tu dong nap dung cum roi resolve.
// Tra loi ngay (Promise da resolve) neu ham co san - khong ton chi phi cho duong da nap.
function ensureFnReady(fnName) {
  if (typeof window[fnName] === "function") return Promise.resolve();
  const grp = MODULE_FN_GROUP[fnName];
  if (!grp) return Promise.reject(new Error("Khong ro mo-dun chua ham '" + fnName + "'"));
  return loadModuleGroup(grp);
}

// loadVendorScript() — CHUYỂN từ module-internalcomms-daotao-viewer.js sang đây (Hạ tầng: nạp module
// theo cụm, đợt 7). core-devicesecurity.js (WebAuthn vân tay/Face ID, luôn nạp sẵn — có thể được gọi
// ngay ở màn đăng nhập, TRƯỚC khi có currentUser) và core.js (dưới đây) đều gọi thẳng hàm này để tải thư
// viện /vendor/* CHỈ LÚC THỰC SỰ CẦN — không thể để nằm ở 1 file module-*.js được nạp lười theo tab.
const _loadedVendorScripts = {};
function loadVendorScript(src) {
  if (_loadedVendorScripts[src]) return _loadedVendorScripts[src];
  _loadedVendorScripts[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => { delete _loadedVendorScripts[src]; reject(new Error('Không tải được thư viện ' + src)); };
    document.head.appendChild(s);
  });
  return _loadedVendorScripts[src];
}

// SENSITIVE_CATEGORY_LABELS/SENSITIVE_CATEGORY_SEVERE - CHUYEN tu module-admin.js sang day (Ha tang:
// nap module theo cum, dot 7) - getMyPendingApprovals() (core-approvalhub.js, luon nap san, quet binh
// luan bi gan co nhay cam o MOI switchTab()) goi thang 2 hang so nay - khong the de nam o 1 file
// module-*.js duoc nap luoi. CUC_DOAN/PHAN_DONG hien noi bat hon (do dam) trong man Phe Duyet.
const SENSITIVE_CATEGORY_LABELS = { TUC_TIU: 'Tục tĩu', TIEU_CUC: 'Tiêu cực', CUC_DOAN: 'Cực đoan', PHAN_DONG: 'Phản động nhà nước' };
const SENSITIVE_CATEGORY_SEVERE = new Set(['CUC_DOAN', 'PHAN_DONG']);

// itPriceHasUnresolvedInfoRequest() - CHUYEN tu module-itsupport-price.js sang day (Ha tang: nap module
// theo cum, dot 7) - getMyPendingApprovals() (core-approvalhub.js, luon nap san) goi thang ham nay o MOI
// switchTab() de tinh badge trang thai cua hang muc "Phe Duyet Gia" trong Hop Thu Duyet Tong Hop.
function itPriceHasUnresolvedInfoRequest(p) {
  return (p.infoRequests || []).some(r => !r.response);
}

// --- KHỞI TẠO DỮ LIỆU DB v6.0 ---
const DB = {
  depts: [], cats: [], users: [], docs: [],
  deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
  jobTitles: [], submissionTypes: [], contractTypes: [], carTypes: [], uniformCatalog: [], itTicketCategories: [],
  workflows: [], deptWorkflows: {},
  submissions: [], submissionDeptWorkflows: {},
  submissionTypeDeptWorkflows: {}, submissionApprovalGroups: {},
  contracts: [], contractApprovalGroups: {}, contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
  meetings: [],
  carRegs: [], carDeptWorkflows: {},
  officeReqs: [],
  officeBuyDeptWorkflows: {},
  officeFixDeptWorkflows: {},
  // "officeInvestDeptWorkflows" (Đầu Tư) đã bị xoá hoàn toàn khỏi module Tổng Hợp.
  meetingMinutes: [],
  meetingAttendeeTemplates: [],
  tasks: [],
  internalPosts: [],
  // "Chuyên đề" cho Nhịp Sống HCRC (NEWS) / Góc Chia Sẻ (SHARE) — {key,label}[] admin tự thêm/bớt ở màn
  // Biểu Mẫu (xem CORE_FIELD_MANIFEST.INTERNAL_POST), cùng khuôn DB.submissionTypes.
  internalNewsCategories: [], internalShareCategories: [],
  trainingCategories: [], trainingDocuments: [], trainingClasses: [], trainingRegistrations: [],
  careerPaths: [], careerPathConfirmations: [],
  trainingTests: [], trainingTestSubmissions: [], trainingCourses: [], trainingPlans: [],
  // trainingDocumentProgress (video 0.5x-1.5x/xem hết PDF mới tính hoàn thành) — riêng tư theo người
  // dùng, xem lib/recordViewScope.js filterTrainingDocumentProgressForUser().
  trainingDocumentProgress: [],
  onboardingPaths: [], onboardingProgress: [],
  recruitmentJobs: [], recruitmentReferrals: [],
  // hrFeedback (Nhân Sự — "HCRC Đồng Hành"): câu hỏi RIÊNG TƯ của nhân viên + phản hồi của Nhân Sự.
  hrFeedback: [],
  sensitiveKeywords: [],
  paymentRequests: [],
  formTemplates: {},
  permGroups: [],
  vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [],
  pwaShortcutModules: [],
  itPriceMasterLists: [],
  uploadFileTypeConfig: {}, uploadSizeLimitConfig: {},
  emailConfig: {}, systemLogs: [],
  externalApiKeys: [],
  // Version (UpdatedAt) từng collection tại lần đọc gần nhất — gửi kèm header If-Match khi ghi
  // (syncStorage()) để server phát hiện xung đột nếu người khác đã ghi đè kể từ lúc đọc (Bước 1:
  // optimistic concurrency, xem routes/data.js). KHÔNG phải 1 collection thật, không sync lên server.
  _versions: {}
};

let currentUser = null;
let editingGroupId = null;
let permFormMode = 'USER'; // 'USER' | 'GROUP' — form Người dùng/Nhóm phân quyền dùng chung 1 bộ checkbox
// Danh sách người dùng mới đang xếp hàng chờ, CHƯA lưu lên server — cho phép tạo nhiều người rồi mới
// bấm lưu 1 lần thay vì phải lưu ngay sau mỗi người (xem addUserToStagingList()/commitPendingNewUsers()).
let pendingNewUsers = [];
let activeWfMod = 'DOC';
// Loại tờ trình đang chọn để cấu hình quy trình riêng — chỉ áp dụng khi activeWfMod === 'SUBMISSION'.
// Gán giá trị thật lần đầu mở đúng tab này (switchWfModule()), lúc đó DB.submissionTypes chắc chắn
// đã tải xong (mặc định activeWfMod ban đầu là 'DOC', không phải 'SUBMISSION').
let activeWfSubmissionType = null;
// Lựa chọn mẫu quy trình CHƯA lưu (preview) theo phòng ban khi đang cấu hình — xem onWorkflowTemplateChange().
let pendingWfTemplate = {};
let activeOfficeSubTab = 'MUA_BAN';
let activeSystemSubTab = 'ADMIN';
let activeAdminSubTab = 'PERMS';
let activeVppSubTab = 'REGISTER';
let currentProcessingVppRegId = null;
// Id hồ sơ NHÁP đang được sửa trong form đăng ký ở trên (null = form đang tạo mới, chưa lưu lần nào).
let vppFormDraftId = null;
let activeFormTab = 'SUBMISSION';
// Nhóm cấp 1 đang chọn ở thanh tab Biểu Mẫu (mirror activeWfMod) — luôn khớp group của activeFormTab,
// xem switchFormTab()/switchFormGroup() ở khối "8. FORM BUILDER". Khởi tạo tạm bằng key group của
// SUBMISSION (không gọi getFormGroupForTab() ở đây vì FORM_TABS/FORM_GROUPS là const khai báo SAU dòng
// này — sẽ được switchFormTab() tính lại đúng ngay khi màn Biểu Mẫu thực sự mở lần đầu).
let activeFormGroup = 'SUBMISSION';
let editingCustomFieldId = null;
// Khác null khi form Biểu Mẫu đang sửa 1 trường MẶC ĐỊNH (không phải trường bổ sung) — { coreKey,
// fieldId }. Loại trừ lẫn nhau với editingCustomFieldId (chỉ 1 trong 2 khác null tại 1 thời điểm).
let editingCoreField = null;

// Danh mục các trường "mặc định" (đã có sẵn trong form nghiệp vụ) của mỗi module — dùng để
// liệt kê đầy đủ trong module Biểu mẫu. Các trường này chỉ cho phép sửa Nhãn hiển thị + Bắt buộc
// nhập (áp dụng trực tiếp lên form thật qua applyCoreFieldCustomizations), KHÔNG cho xóa / đổi kiểu
// dữ liệu vì rất nhiều logic nghiệp vụ (phân quyền, duyệt, kiểm tra trùng lịch, nhắc hết hạn, báo cáo...)
// phụ thuộc vào tên/kiểu thuộc tính cố định của các trường này.
// optionsKey: riêng 3 trường dropdown "danh sách lựa chọn cố định" (Loại Tờ Trình/Pháp Lý/Xe — TRƯỚC
// ĐÂY gõ cứng <option>, nay đổ động từ DB, xem populateDropdowns()) cho sửa thêm DANH SÁCH LỰA CHỌN
// qua nút Sửa ở màn Biểu Mẫu (không phải đổi kiểu dữ liệu, chỉ thêm/bớt giá trị trong dropdown có
// sẵn) — trỏ đúng tên key trong DB. optionsIsKeyLabel:true = danh sách dạng {key,label}[] (giữ
// key ổn định cho submissionTypeDeptWorkflows), false/thiếu = danh sách chuỗi phẳng như depts/cats.
const CORE_FIELD_MANIFEST = {
  SUBMISSION: [
    { id: 'subCode', label: 'Mã Văn Bản Trình / Tờ Trình', required: true },
    { id: 'subDept', label: 'Phòng Ban Trình', required: true },
    { id: 'subType', label: 'Loại Tờ Trình', required: true, optionsKey: 'submissionTypes', optionsIsKeyLabel: true },
    { id: 'subTitle', label: 'Tên / Trích Yếu Tờ Trình', required: true },
    { id: 'subPriority', label: 'Độ Khẩn', required: false },
    { id: 'subFile', label: 'Tờ Trình', required: false },
    { id: 'subExtraFiles', label: 'Tài Liệu Bổ Sung Theo Tờ Trình', required: false },
    { id: 'subContent', label: 'Nội Dung Trình Chi Tiết & Đề Xuất Cụ Thể', required: true }
  ],
  CONTRACT: [
    { id: 'contractCode', label: 'Mã Hợp Đồng / Giấy Phép', required: true },
    { id: 'contractDept', label: 'Phòng Ban Quản Lý', required: true },
    { id: 'contractType', label: 'Loại Pháp Lý', required: true, optionsKey: 'contractTypes' },
    { id: 'contractTitle', label: 'Tên Hợp Đồng / Tên Giấy Phép', required: true },
    { id: 'contractPartner', label: 'Đối Tác / Bên Ký Kết', required: true },
    { id: 'contractAmount', label: 'Giá Trị Hợp Đồng (VNĐ)', required: true },
    { id: 'contractStartDate', label: 'Ngày Hiệu Lực', required: true },
    { id: 'contractEndDate', label: 'Ngày Hết Hạn', required: true },
    { id: 'contractFile', label: 'Tệp Đính Kèm Hợp Đồng / Giấy Phép', required: true },
    { id: 'contractContent', label: 'Nội Dung Tóm Tắt & Điều Khoản Chính', required: true }
  ],
  CAR: [
    { id: 'carCode', label: 'Mã Phiếu Đăng Ký', required: true },
    { id: 'carDept', label: 'Đơn Vị (Phòng/Ban/Bộ phận)', required: true },
    { id: 'carType', label: 'Đăng Ký Sử Dụng Loại Xe', required: true, optionsKey: 'carTypes' },
    { id: 'carPassengers', label: 'Số Người Sử Dụng', required: true },
    { id: 'carDirectUser', label: 'Người Sử Dụng Trực Tiếp', required: false },
    { id: 'carDirectUserPhone', label: 'SĐT Người Sử Dụng Trực Tiếp', required: false },
    { id: 'carPurpose', label: 'Mục Đích Sử Dụng', required: true },
    { id: 'carKm', label: 'Số KM Dự Kiến (2 chiều)', required: true },
    { id: 'carStartTime', label: 'Thời Gian Bắt Đầu Đi', required: true },
    { id: 'carEndTime', label: 'Thời Gian Dự Kiến Về', required: true },
    { id: 'carDestination', label: 'Lộ Trình Di Chuyển', required: true }
  ],
  OFFICE: [
    { id: 'offCode', label: 'Mã Yêu Cầu', required: true },
    { id: 'offDept', label: 'Phòng Ban Trình', required: true },
    { id: 'offTitle', label: 'Tên Hạng Mục / Nội Dung Trình', required: true },
    { id: 'offQty', label: 'Số Lượng / Quy Mô', required: true },
    { id: 'offAmount', label: 'Dự Toán / Tổng Chi Phí (VNĐ)', required: true },
    { id: 'offSupplier', label: 'Đối Tác / Nhà Cung Cấp', required: false },
    { id: 'offUsageTime', label: 'Thời Gian Cần Sử Dụng', required: false }
  ],
  DOC: [
    { id: 'docCode', label: 'Mã Tài Liệu', required: true },
    { id: 'docTitle', label: 'Tên / Tiêu Đề Tài Liệu', required: true },
    { id: 'docVer', label: 'Phiên Bản', required: true },
    { id: 'selDept', label: 'Phòng Ban Trình', required: true },
    { id: 'selCat', label: 'Phân Loại', required: true, optionsKey: 'cats' },
    { id: 'docFile', label: 'Tệp Tài Liệu', required: true },
    { id: 'docSummary', label: 'Trích Lục / Tóm Tắt Nội Dung', required: true }
  ],
  MEETING_MINUTES: [
    { id: 'minutesCode', label: 'Mã Biên Bản Họp', required: true },
    { id: 'minutesTitle', label: 'Chủ Đề Cuộc Họp', required: true },
    { id: 'minutesTime', label: 'Thời Gian Họp', required: true },
    { id: 'minutesChair', label: 'Người Chủ Trì', required: true },
    { id: 'minutesSecretary', label: 'Người Ghi Biên Bản', required: true },
    { id: 'minutesContent', label: 'Nội Dung Trao Đổi / Kết Luận', required: true }
  ],
  MEETING_ROOM: [
    { id: 'meetingCode', label: 'Mã Phiếu Đặt Phòng', required: true },
    { id: 'meetingDept', label: 'Phòng Ban Đặt Lịch', required: true },
    { id: 'meetingRoom', label: 'Chọn Phòng Họp', required: true },
    { id: 'meetingTitle', label: 'Chủ Đề Cuộc Họp', required: true },
    { id: 'meetingAttendees', label: 'Số Lượng Người Tham Dự', required: true },
    { id: 'meetingStartTime', label: 'Thời Gian Bắt Đầu', required: true },
    { id: 'meetingEndTime', label: 'Thời Gian Kết Thúc', required: true },
    { id: 'meetingEquipment', label: 'Thiết Bị Hỗ Trợ Yêu Cầu', required: false },
    { id: 'meetingAgenda', label: 'Nội Dung / Chương Trình Họp Chi Tiết', required: true }
  ],
  // Truyền Thông Nội Bộ (Đợt 1 Nhịp Sống HCRC/Góc Chia Sẻ) — 2 trường "Chuyên đề" thật sự tồn tại trong
  // #internalPostForm (id khớp đúng <select> tương ứng, ẩn/hiện theo activeInternalSubTab — xem
  // setInternalSubTab()), optionsKey trỏ DB.internalNewsCategories/internalShareCategories
  // (defaults.js, ADMIN_ONLY_KEYS ở routes/data.js) — cùng khuôn subType ở trên (optionsIsKeyLabel:true
  // để GIỮ NGUYÊN key ổn định, tránh mồ côi postCategory đã lưu trên các bài viết cũ khi admin đổi nhãn).
  INTERNAL_POST: [
    { id: 'internalPostCategory', label: 'Chuyên Đề Nhịp Sống HCRC', required: true, optionsKey: 'internalNewsCategories', optionsIsKeyLabel: true },
    { id: 'internalPostCategoryShare', label: 'Chuyên Đề Góc Chia Sẻ', required: true, optionsKey: 'internalShareCategories', optionsIsKeyLabel: true }
  ],
  // ===== Biểu Mẫu Đợt 1 (Công Việc/VPP/Giấy Phép/Hỗ Trợ IT) =====
  // TASK: modal #createTaskModal (Giao Việc) — dùng chung 3 chế độ CREATE/ASSIGN/EDIT (taskModalMode),
  // 4 field mặc định ở đây chỉ có mặt/áp dụng ở chế độ CREATE/EDIT (ASSIGN chỉ đổi người nhận/hạn, xem
  // confirmCreateTask()). taskAssigneeInput không có <label> RIÊNG bọc cùng khối (input.closest('div')
  // trỏ đúng wrapper #taskAssigneeSingleWrap không chứa <label>) nên applyCoreFieldCustomizations() rơi
  // vào nhánh fallback cập nhật PLACEHOLDER thay vì <label> — chấp nhận được, đúng khuôn tài liệu đã ghi
  // ở applyCoreFieldCustomizations().
  TASK: [
    { id: 'taskTitleInput', label: 'Tiêu Đề Công Việc', required: true },
    { id: 'taskDescInput', label: 'Mô Tả / Nội Dung', required: false },
    { id: 'taskAssigneeInput', label: 'Người Nhận', required: true },
    { id: 'taskDeadlineInput', label: 'Hạn Hoàn Thành', required: false }
  ],
  // VPP: module Văn Phòng Phẩm KHÔNG có form nhập liệu cố định kiểu 1 hồ sơ (đăng ký = chọn số lượng
  // trực tiếp trên bảng danh mục hàng hoá động theo từng kỳ, không phải field cố định) — bộ field mặc
  // định duy nhất có ý nghĩa để admin sửa nhãn/bắt buộc là form "➕ Tạo Kỳ Đăng Ký Mới" (chỉ
  // vppManage/admin thấy, sub-tab Kỳ Đăng Ký).
  VPP: [
    { id: 'vppNewPeriodName', label: 'Tên Kỳ Đăng Ký', required: true },
    { id: 'vppNewPeriodStart', label: 'Ngày Bắt Đầu', required: false },
    { id: 'vppNewPeriodEnd', label: 'Ngày Kết Thúc', required: false },
    { id: 'vppNewPeriodBudget', label: 'Ngân Sách Văn Phòng Phẩm / Người (VNĐ)', required: false }
  ],
  // LICENSE: #licenseForm (Tải Lên Giấy Phép). licenseType optionsKey trỏ DB.licenseTypes — danh sách
  // NÀY TRƯỚC ĐÂY ĐÃ admin-editable qua màn Quản Lý Danh Mục riêng (saveLicenseType()/deleteLicenseType(),
  // ADMIN_ONLY_KEYS) VÀ tự học thêm khi ai gõ loại mới (uploadLicense()) — optionsKey ở đây chỉ THÊM 1
  // lối sửa nữa (cùng khuôn 'cats' của DOC cũng có 2 lối sửa song song), KHÔNG thay thế cơ chế tự học.
  // licenseOperatingStatus (ACTIVE/CLOSED) KHÔNG có optionsKey — 2 giá trị này là trạng thái hệ thống cố
  // định (không phải danh sách nhãn tự do).
  LICENSE: [
    { id: 'licenseCode', label: 'Mã Giấy Phép', required: true },
    { id: 'licenseCompanyName', label: 'Tên Công Ty Chủ Quản', required: true },
    { id: 'licenseLocationName', label: 'Tên Địa Điểm', required: true },
    { id: 'licenseOperatingStatus', label: 'Tình Trạng Hoạt Động', required: true },
    { id: 'licenseType', label: 'Tên Giấy Phép / Loại Giấy Phép', required: true, optionsKey: 'licenseTypes' },
    { id: 'licenseNumber', label: 'Số Giấy Phép', required: true },
    { id: 'licenseIssueDate', label: 'Ngày Cấp', required: true },
    { id: 'licenseExpiryDate', label: 'Ngày Hết Hạn', required: true },
    { id: 'licenseIssuingAuthority', label: 'Cơ Quan Cấp Phép', required: true },
    { id: 'licenseFile', label: 'Tệp Đính Kèm Giấy Phép', required: true }
  ],
  // IT_PRICE: #itPriceCreateForm (Hỗ Trợ IT > Đề Xuất Duyệt Giá Bán). itPriceMasterListSelect/itPriceTier
  // KHÔNG có optionsKey — mẫu giá (itPriceMasterLists) đã có màn quản trị riêng (chọn KHUÔN CỘT, không
  // phải nhãn thuần), còn itPriceTier (Margin/Chiết Khấu) là 4 mức CỐ ĐỊNH gắn trực tiếp với cấu hình
  // quy trình duyệt riêng theo mức (itPriceTierWorkflows) — đổi khoá ở đây sẽ làm mồ côi cấu hình duyệt
  // đã gán, nên KHÔNG đưa vào diện admin tự thêm/bớt giá trị (chỉ sửa nhãn/bắt buộc như mọi field khác).
  IT_PRICE: [
    { id: 'itPriceCode', label: 'Mã Đề Xuất', required: false },
    { id: 'itPriceDeptDisplay', label: 'Phòng Ban Đề Xuất', required: false },
    { id: 'itPriceMasterListSelect', label: 'Mẫu Giá Phê Duyệt', required: false },
    { id: 'itPriceTier', label: 'Mức Margin / Chiết Khấu', required: false },
    { id: 'itPriceFileInput', label: 'Tệp Bảng Giá (.xlsx)', required: false },
    { id: 'itPriceReason', label: 'Lý Do Điều Chỉnh Giá', required: false },
    { id: 'itPriceExtraFiles', label: 'Tài Liệu Bổ Sung Liên Quan', required: false }
  ],
  // IT_TICKET: #itTicketCreateForm (Hỗ Trợ IT > Hỗ Trợ Yêu Cầu). itTicketCategory optionsKey trỏ DB.
  // itTicketCategories (MỚI — TRƯỚC ĐÂY gõ cứng <option>, xem defaults.js + populateItTicketCategorySelect()),
  // optionsIsKeyLabel:true để GIỮ NGUYÊN key ổn định (tránh mồ côi t.category đã lưu trên ticket cũ, cùng
  // khuôn submissionTypes/internalNewsCategories).
  IT_TICKET: [
    { id: 'itTicketCode', label: 'Mã Yêu Cầu', required: false },
    { id: 'itTicketTitle', label: 'Tiêu Đề', required: true },
    { id: 'itTicketCategory', label: 'Danh Mục', required: false, optionsKey: 'itTicketCategories', optionsIsKeyLabel: true },
    { id: 'itTicketDescription', label: 'Mô Tả Chi Tiết', required: true }
  ],
  // ===== Biểu Mẫu Đợt 2 (Thanh Toán/Ngân Sách/Báo Cáo Định Kỳ/Đồng Phục) =====
  // PAYMENT: #paymentCreateForm (Tổng Hợp > Thanh Toán > Tạo Mới). paymentSourceType (Loại Đề Nghị:
  // Thủ công/Hợp đồng/Mua Bán/Sửa Chữa) KHÔNG có optionsKey — 4 giá trị này gắn trực tiếp với logic rẽ
  // nhánh lấy hồ sơ nguồn (populatePaymentSourceRecordOptions()), đổi/thêm giá trị ở đây mà không sửa
  // code sẽ không có tác dụng gì (KHÔNG đưa vào diện admin tự thêm/bớt, chỉ sửa nhãn/bắt buộc — cùng lý
  // do itPriceTier ở Đợt 1). paymentSourceRecord.required TỰ ĐỘNG đổi theo paymentSourceType lúc người
  // dùng thao tác thật (onPaymentSourceTypeChange(), true trừ khi Thủ công) — override "Bắt buộc" ở đây
  // chỉ có hiệu lực làm giá trị KHỞI ĐẦU (lúc nạp trang/lúc admin lưu), form vẫn tự ghi đè lại đúng theo
  // luồng chọn của người dùng ngay sau đó, không phá logic.
  PAYMENT: [
    { id: 'paymentSourceType', label: 'Loại Đề Nghị', required: false },
    { id: 'paymentSourceRecord', label: 'Chọn Hồ Sơ Nguồn', required: true },
    { id: 'paymentDept', label: 'Phòng Ban', required: true },
    { id: 'paymentTitle', label: 'Tiêu Đề / Nội Dung Thanh Toán', required: true }
  ],
  // BUDGET_PERIOD: form "📅 Tạo Kỳ Ngân Sách Mới" trong modal #budgetPeriodTemplateModal (Ngân Sách >
  // ⚙️ Quản Lý Kỳ & Mẫu). LƯU Ý: bảng dòng ngân sách thật (#budgetEntryFormWrap_PLAN/_ACTUAL, nhập theo
  // từng kỳ) KHÔNG đưa vào CORE_FIELD_MANIFEST — module này đã có cơ chế tự sửa nhãn/bắt buộc/thêm-bớt
  // cột RIÊNG còn mạnh hơn (BUDGET_CORE_FIELD_DEFS + "🧩 Mẫu Ngân Sách" bên dưới, admin tự do đổi nhãn
  // 3 cột lõi Tên Hạng Mục/Số Tiền/Loại NS theo TỪNG MẪU qua bảng ở #budgetTemplateFieldsBody, xem
  // renderBudgetTemplateFieldsBuilder()) — gộp thêm vào Biểu Mẫu sẽ chỉ tạo 2 lối sửa chồng chéo, xung
  // đột nhau (mẫu khác nhau có nhãn khác nhau, không có 1 nhãn "mặc định" duy nhất để CORE_FIELD_MANIFEST
  // áp).
  BUDGET_PERIOD: [
    { id: 'budgetPeriodName', label: 'Tên Kỳ Ngân Sách', required: true },
    { id: 'budgetPeriodEndTime', label: 'Hạn Chót Lập', required: true },
    { id: 'budgetPeriodTemplateSelect', label: 'Mẫu Ngân Sách', required: false }
  ],
  // BUDGET_TEMPLATE: form "🧩 Mẫu Ngân Sách" (#budgetTemplateForm, cùng modal ⚙️ Quản Lý Kỳ & Mẫu) —
  // chỉ riêng "Tên Mẫu" (field cố định ngoài bảng cột động) là ứng viên hợp lệ ở đây; bản thân bảng cột
  // (budgetTemplateFieldsBody) đã tự sửa được ngay tại chỗ (không qua Biểu Mẫu, xem BUDGET_PERIOD ở trên).
  BUDGET_TEMPLATE: [
    { id: 'budgetTemplateName', label: 'Tên Mẫu', required: true }
  ],
  // REPORT_ENTRY: form "📝 Nhập Báo Cáo" (#prEntryFormWrap, Báo Cáo Định Kỳ > Nhập Báo Cáo). Ô chọn kỳ
  // (prEntryPeriodSelect) KHÔNG đưa vào — chọn kỳ là chọn 1 bản ghi có sẵn (không phải nhãn tự do), cùng
  // lý do loại trừ paymentSourceType ở trên. Đã bỏ hẳn hình thức nộp PowerPoint (.pptx, radio
  // prEntryMode + ô prEntryPptxFile) — PDF (ghép bằng pdf-lib) giờ là hình thức DUY NHẤT.
  REPORT_ENTRY: [
    { id: 'prEntryTitle', label: 'Tiêu Đề Báo Cáo', required: false },
    { id: 'prEntryPdfFiles', label: 'Tệp Báo Cáo PDF', required: false }
  ],
  // REPORT_PERIOD: form "📅 Tạo Kỳ Báo Cáo Mới" (#prSubPeriods, chỉ reportManage/admin).
  REPORT_PERIOD: [
    { id: 'prPeriodName', label: 'Tên Kỳ Báo Cáo', required: true },
    { id: 'prPeriodEndTime', label: 'Hạn Chót Nộp', required: true }
  ],
  // ===== Đồng Phục — 5 form nhập liệu thật riêng biệt (mỗi form đủ điều kiện coreKey riêng, không dùng
  // chung field nào) — #uniformCatalogAdminForm (Tên Đồng Phục/Size) KHÔNG đưa vào, cùng lý do
  // licenseTypes/contractTypes ở Đợt 1: đây là màn "Quản Lý Danh Mục" (CRUD danh sách), không phải form
  // tạo 1 hồ sơ nghiệp vụ — admin đã sửa/xoá tự do trực tiếp tại đó rồi.
  // UNIFORM_PERIOD: "📦 Tạo Kỳ Cấp Phát Đồng Phục" (#uniformCreatePeriodBlock).
  UNIFORM_PERIOD: [
    { id: 'uniformPeriodName', label: 'Tên Kỳ Cấp Phát', required: true },
    { id: 'uniformPeriodNote', label: 'Ghi Chú', required: false }
  ],
  // UNIFORM_ISSUE: "👕 Cấp Đồng Phục Cho Nhân Viên" (#uniformSubStore).
  UNIFORM_ISSUE: [
    { id: 'uniformIssueEmployee', label: 'Nhân Viên', required: true },
    { id: 'uniformIssueCode', label: 'Mã Phiếu', required: false },
    { id: 'uniformIssueNote', label: 'Ghi Chú', required: false }
  ],
  // UNIFORM_ADJUST_STOCK: "🗑️ Báo Hỏng / Hủy (Từ Kho)". uniformAdjStockOutcome (2 radio Hỏng/Hủy) KHÔNG
  // đưa vào — trạng thái hệ thống cố định gắn trực tiếp xử lý tồn kho (cùng lý do licenseOperatingStatus
  // ở Đợt 1), không phải nhãn tự do.
  UNIFORM_ADJUST_STOCK: [
    { id: 'uniformAdjStockItemSize', label: 'Đồng Phục — Size', required: true },
    { id: 'uniformAdjStockQty', label: 'Số Lượng', required: true },
    { id: 'uniformAdjStockReason', label: 'Lý Do', required: true }
  ],
  // UNIFORM_ADJUST_EMPLOYEE: "↩️ Thu Hồi Từ Nhân Viên". uniformAdjEmpOutcome (4 radio Về Tồn Kho/Hỏng/
  // Hủy/Mất) KHÔNG đưa vào — cùng lý do uniformAdjStockOutcome ở trên.
  UNIFORM_ADJUST_EMPLOYEE: [
    { id: 'uniformAdjEmpEmployee', label: 'Nhân Viên', required: true },
    { id: 'uniformAdjEmpItemSize', label: 'Mặt Hàng — Size', required: true },
    { id: 'uniformAdjEmpQty', label: 'Số Lượng', required: true },
    { id: 'uniformAdjEmpReason', label: 'Lý Do', required: true }
  ],
  // UNIFORM_TRANSFER: "🔁 Điều Chuyển Kho Giữa Các Siêu Thị" (#uniformTransferRequestForm).
  UNIFORM_TRANSFER: [
    { id: 'uniformTransferTargetDept', label: 'Siêu Thị Nhận', required: true },
    { id: 'uniformTransferItemSize', label: 'Mặt Hàng — Size', required: true },
    { id: 'uniformTransferQty', label: 'Số Lượng', required: true },
    { id: 'uniformTransferReason', label: 'Lý Do', required: true }
  ],
  // ===== Biểu Mẫu Đợt 3 (Vận Hành/Đào Tạo/Tuyển Dụng) =====
  // OPERATION_ORDER: #operationOrderForm (Vận Hành > Phê Duyệt Đơn Hàng > Tạo Đơn Hàng Mới). Bảng
  // "Danh Sách Hạng Mục Đặt Hàng" (operationOrderItemsTableBody) KHÔNG đưa vào — hàng động do người
  // dùng tự thêm/bớt (addOperationOrderItemRow()), không phải field cố định có id ổn định, cùng lý do
  // budgetEntries/bảng dòng ngân sách bị loại ở Đợt 2.
  OPERATION_ORDER: [
    { id: 'voCode', label: 'Mã Đơn Hàng', required: false },
    { id: 'voTitle', label: 'Tiêu Đề Đơn Hàng', required: true },
    { id: 'voSupplier', label: 'Nhà Cung Cấp', required: false },
    { id: 'voFile', label: 'File Đính Kèm', required: false },
    { id: 'voNote', label: 'Ghi Chú', required: false }
  ],
  // OPERATION_STORE_OPEN: #operationStoreOpenForm (Vận Hành > Siêu Thị > Mở mới > Tạo Đề Xuất).
  OPERATION_STORE_OPEN: [
    { id: 'vsoCode', label: 'Mã Đề Xuất', required: false },
    { id: 'vsoStoreName', label: 'Tên Siêu Thị Dự Kiến', required: true },
    { id: 'vsoAddress', label: 'Địa Điểm Dự Kiến', required: true },
    { id: 'vsoArea', label: 'Diện Tích Dự Kiến (m²)', required: false },
    { id: 'vsoBudget', label: 'Chi Phí Phê Duyệt (VNĐ)', required: false },
    { id: 'vsoApprovedBudget', label: 'Ngân Sách Phê Duyệt — Danh Mục Đầu Tư (VNĐ)', required: true },
    { id: 'vsoOpenDate', label: 'Ngày Dự Kiến Khai Trương', required: false },
    { id: 'vsoPersonInChargeInput', label: 'Người Phụ Trách', required: false },
    { id: 'vsoFile', label: 'Tài Liệu Đính Kèm', required: false },
    { id: 'vsoNote', label: 'Ghi Chú', required: false }
  ],
  // OPERATION_REPAIR: #operationRepairForm (Vận Hành > Siêu Thị > Sửa chữa > Tạo Đề Xuất).
  OPERATION_REPAIR: [
    { id: 'vrCode', label: 'Mã Đề Xuất', required: false },
    { id: 'vrStoreName', label: 'Siêu Thị Cần Sửa Chữa', required: true },
    { id: 'vrTitle', label: 'Nội Dung Sửa Chữa', required: true },
    { id: 'vrAmount', label: 'Chi Phí Phê Duyệt (VNĐ)', required: false },
    { id: 'vrApprovedBudget', label: 'Ngân Sách Phê Duyệt — Danh Mục Đầu Tư (VNĐ)', required: true },
    { id: 'vrSupplier', label: 'Nhà Cung Cấp / Đơn Vị Thi Công', required: false },
    { id: 'vrPersonInChargeInput', label: 'Người Phụ Trách', required: false },
    { id: 'vrDescription', label: 'Mô Tả Chi Tiết Hiện Trạng & Lý Do Sửa Chữa', required: false },
    { id: 'vrFile', label: 'Tài Liệu Đính Kèm', required: false }
  ],
  // OPERATION_WORK_ITEM: #operationWorkItemFormModal (Vận Hành > Siêu Thị > Thực hiện/Nghiệm thu > Thêm
  // Công Việc, dùng CHUNG cho tạo mới lẫn sửa). owiAssignedToPicker (renderPeopleMultiSelect(), div
  // container không phải input/không có <label> RIÊNG bên trong) KHÔNG đưa vào — cùng lý do mọi picker
  // nhiều người khác (groupMembersPicker...) chưa từng vào diện Biểu Mẫu. owiPeriodSelect (chọn 1 Kỳ
  // Thực Hiện có sẵn) và owiAcceptanceMode (radio, không có id chung cho cả nhóm — applyCoreFieldCustomizations()
  // cần đúng 1 id) KHÔNG đưa vào, cùng lý do prEntryPeriodSelect/prEntryMode ở Đợt 2.
  OPERATION_WORK_ITEM: [
    { id: 'owiTitle', label: 'Tên Công Việc', required: true },
    { id: 'owiDescription', label: 'Mô Tả', required: false },
    { id: 'owiAcceptorInput', label: 'Người Nghiệm Thu Chỉ Định', required: false },
    { id: 'owiDeadline', label: 'Hạn Hoàn Thành', required: false }
  ],
  // TRAINING_CLASS: #trainingClassForm (Đào Tạo > Lớp Học > Tạo Lớp Học Mới). tcCategory optionsKey trỏ
  // DB.trainingCategories — danh sách NÀY ĐÃ admin-editable qua màn Quản Lý Danh Mục riêng (khối "Loại
  // Đào Tạo" trong module Đào Tạo) VÀ optionsKey ở đây chỉ THÊM 1 lối sửa song song, cùng khuôn
  // licenseType/contractType ở Đợt 1. tcMode (Online/Offline) KHÔNG có optionsKey — cùng lý do
  // licenseOperatingStatus. tcDocumentIds (Giáo Trình) KHÔNG đưa vào — nhãn của field này được
  // onTrainingClassModeChange() TỰ ĐỘNG đổi qua lại theo #tcMode (2 câu chữ khác nhau tùy Online/Offline,
  // xem hàm đó) MỖI LẦN vào lại module/đổi sub-tab (renderTrainingLms() gọi onTrainingClassModeChange()
  // không điều kiện) — nếu đưa vào manifest, nhãn admin tùy biến sẽ liên tục bị hàm này ghi đè lại ngay
  // sau khi tải trang, khác hẳn mọi field khác trong hệ thống (chỉ đổi 1 lần lúc tải, không đổi lại sau).
  TRAINING_CLASS: [
    { id: 'tcCategory', label: 'Loại Đào Tạo', required: true, optionsKey: 'trainingCategories' },
    { id: 'tcTitle', label: 'Tên Lớp Học', required: true },
    { id: 'tcMode', label: 'Kiểu Lớp Học', required: false },
    { id: 'tcInstructor', label: 'Giảng Viên / Người Phụ Trách', required: false },
    { id: 'tcCourseId', label: 'Chương Trình', required: false },
    { id: 'tcStart', label: 'Thời Gian Bắt Đầu', required: true },
    { id: 'tcEnd', label: 'Thời Gian Kết Thúc', required: false },
    { id: 'tcLocation', label: 'Địa Điểm / Hình Thức', required: false },
    { id: 'tcDeadline', label: 'Hạn Đăng Ký', required: false },
    { id: 'tcCapacity', label: 'Số Lượng Tối Đa', required: false },
    { id: 'tcPassScore', label: 'Điểm Đạt Yêu Cầu (%)', required: false },
    { id: 'tcTestId', label: 'Bài Test Gán Cho Lớp', required: false },
    { id: 'tcTestSecondsPerQuestion', label: 'Số Giây / Câu Hỏi', required: false },
    { id: 'tcDescription', label: 'Mô Tả / Nội Dung', required: false }
  ],
  // TRAINING_TEST: #trainingTestForm (Đào Tạo > Ngân Hàng Câu Hỏi > Tạo Bài Test Mới) — chỉ 3 field cố
  // định NGOÀI khối câu hỏi; bản thân danh sách câu hỏi (tbQuestionsContainer/tbAddQuestion) đã là biểu
  // mẫu HOÀN TOÀN tự do (giảng viên tự gõ nội dung/đáp án từng câu, không có "nhãn mặc định" nào để sửa)
  // nên không xung đột/không cần đưa vào đây — cùng tinh thần loại trừ BUDGET_PERIOD.budgetEntries.
  TRAINING_TEST: [
    { id: 'ttTitle', label: 'Tên Bài Test', required: true },
    { id: 'ttCategory', label: 'Loại Đào Tạo', required: false, optionsKey: 'trainingCategories' },
    { id: 'ttPassScore', label: 'Điểm Đạt Yêu Cầu Gợi Ý (%)', required: false }
  ],
  // RECRUITMENT_JOB: #recruitmentJobForm (Tuyển Dụng > Tin Tuyển Dụng > Đăng Tin Mới). rjDept (chọn đơn
  // vị/siêu thị) KHÔNG có optionsKey — danh sách phòng ban là dữ liệu hệ thống (DB.depts), không phải
  // danh sách nhãn riêng của module này.
  RECRUITMENT_JOB: [
    { id: 'rjTitle', label: 'Tên Vị Trí', required: true },
    { id: 'rjSlots', label: 'Số Lượng Cần Tuyển', required: false },
    { id: 'rjMonth', label: 'Đợt Tuyển (Tháng)', required: false },
    { id: 'rjDept', label: 'Đơn Vị/Siêu Thị Đăng Tuyển', required: false },
    { id: 'rjLocation', label: 'Địa Điểm Làm Việc', required: false },
    { id: 'rjDeadline', label: 'Hạn Nhận Hồ Sơ', required: false },
    { id: 'rjContactInfo', label: 'Thông Tin Liên Hệ', required: true },
    { id: 'rjBannerFile', label: 'Ảnh/Banner Tin Tuyển Dụng', required: false },
    { id: 'rjDescription', label: 'Mô Tả Công Việc', required: true },
    { id: 'rjRequirements', label: 'Yêu Cầu Ứng Viên', required: false }
  ],
  // RECRUITMENT_REFERRAL: #recruitmentReferForm (modal "🙋 Giới Thiệu Ứng Viên", mở từ mọi tin tuyển
  // dụng, ai đăng nhập cũng dùng được). rrJobId (hidden)/rrJobTitleLabel/rrReferrerLabel chỉ là hiển thị
  // tự động, không phải field admin sửa nhãn được.
  RECRUITMENT_REFERRAL: [
    { id: 'rrCandidateName', label: 'Họ Tên Ứng Viên', required: true },
    { id: 'rrCandidatePhone', label: 'Số Điện Thoại', required: true },
    { id: 'rrCandidateEmail', label: 'Email', required: false },
    { id: 'rrCvFile', label: 'CV Ứng Viên', required: true },
    { id: 'rrCandidateNote', label: 'Ghi Chú Thêm', required: false }
  ],
  // HR_FEEDBACK: #hrFeedbackForm ("🤝 HCRC Đồng Hành" — khối riêng sống trong module Truyền Thông Nội Bộ,
  // xem internalQnaSection, mở cho MỌI người gửi câu hỏi tới Nhân Sự) — audit Đợt 3 phát hiện đây là 1
  // biểu mẫu thật (2 field cố định) bị Đợt 1/2 bỏ sót vì không nằm cùng khung #internalPostForm chung.
  // hrFeedbackCategory (4 lựa chọn cố định) KHÔNG có optionsKey — gắn trực tiếp phân loại nội bộ, không
  // phải danh sách tự do như internalNewsCategories.
  HR_FEEDBACK: [
    { id: 'hrFeedbackCategory', label: 'Chủ Đề', required: false },
    { id: 'hrFeedbackQuestion', label: 'Nội Dung Câu Hỏi', required: true }
  ],
  // OPERATION_EXECUTION_PERIOD: đã BỎ HẲN (đợt "Danh Mục Đầu Tư + bỏ Tạo Kỳ", yêu cầu người dùng "bỏ
  // luôn phần tạo kỳ trong màn hình thực hiện và lập công việc") — form "Tạo Kỳ Mới" trong
  // #operationExecutionPeriodsBox không còn tồn tại (xoá khỏi public/index.html), nên coreKey này cũng
  // xoá theo (không còn field nào để admin tuỳ biến nhãn cho 1 form không render nữa) — xem
  // FORM_TABS bên dưới cũng đã bỏ entry OPERATION_EXECUTION_PERIOD tương ứng.
  // IT_RENEWAL: #itRenewalCreateForm (Hỗ Trợ IT > Gia Hạn Dịch Vụ CNTT) — audit Đợt 3 phát hiện đây là 1
  // biểu mẫu thật bị Đợt 1 bỏ sót (Đợt 1 chỉ tách IT_PRICE/IT_TICKET, không có tab con này). itRenewalCategory
  // (free-text + gợi ý tự học qua data-sdd-list, giống licenseType TRƯỚC KHI có optionsKey) KHÔNG có
  // optionsKey ở đợt này — giữ nguyên phạm vi audit, không đụng defaults.js/routes/data.js lần này. Kèm
  // fix lỗi div-wrapping giống #licenseForm Đợt 1 (xem chú thích ngay tại markup #itRenewalCreateForm).
  IT_RENEWAL: [
    { id: 'itRenewalName', label: 'Tên Dịch Vụ', required: true },
    { id: 'itRenewalCategory', label: 'Loại Dịch Vụ', required: true },
    { id: 'itRenewalVendor', label: 'Nhà Cung Cấp', required: false },
    { id: 'itRenewalResponsible', label: 'Người Phụ Trách', required: false },
    { id: 'itRenewalCost', label: 'Chi Phí Gia Hạn (đ)', required: false },
    { id: 'itRenewalStartDate', label: 'Ngày Bắt Đầu', required: false },
    { id: 'itRenewalExpiryDate', label: 'Ngày Hết Hạn', required: true },
    { id: 'itRenewalFile', label: 'Tệp Đính Kèm', required: false },
    { id: 'itRenewalNote', label: 'Ghi Chú', required: false }
  ],
  // ===== Biểu Mẫu Đợt 4 (nốt các form Đào Tạo còn lại — dọn "Phạm vi chưa làm" ghi ở cuối Đợt 3) =====
  // TRAINING_COURSE: #trainingCourseForm (Đào Tạo > Chương Trình > Tạo Chương Trình Mới). tccCategory
  // optionsKey trỏ DB.trainingCategories — CÙNG danh sách với TRAINING_CLASS.tcCategory/TRAINING_TEST.
  // ttCategory (3 field dùng chung 1 nguồn qua populateTrainingCategorySelects(), xem dòng
  // ['tcCategory','tdCategory','tccCategory'].forEach ở renderTrainingLms()) — optionsKey ở đây chỉ
  // THÊM 1 lối sửa song song, cùng khuôn tcCategory ở Đợt 3.
  TRAINING_COURSE: [
    { id: 'tccCategory', label: 'Loại Đào Tạo', required: true, optionsKey: 'trainingCategories' },
    { id: 'tccName', label: 'Tên Chương Trình', required: true },
    { id: 'tccDescription', label: 'Mô Tả (tuỳ chọn)', required: false }
  ],
  // TRAINING_PLAN: #trainingPlanForm (Đào Tạo > Kế Hoạch Đào Tạo > Lập Kế Hoạch Đào Tạo Mới). tpCourseId/
  // tpTargetDept là select tham chiếu dữ liệu khác (trainingCourses/depts, không phải danh sách nhãn cố
  // định) nên KHÔNG có optionsKey — cùng lý do rjDept ở Đợt 3.
  TRAINING_PLAN: [
    { id: 'tpMonth', label: 'Tháng', required: true },
    { id: 'tpCourseId', label: 'Chương Trình (tuỳ chọn)', required: false },
    { id: 'tpTargetDept', label: 'Đơn Vị (tuỳ chọn)', required: false },
    { id: 'tpAudience', label: 'Đối Tượng', required: false },
    { id: 'tpPlannedClasses', label: 'Số Lớp (kế hoạch)', required: false },
    { id: 'tpPlannedTrainees', label: 'Số Học Viên (kế hoạch)', required: false },
    { id: 'tpPlannedHours', label: 'Thời Lượng Đào Tạo (giờ, kế hoạch)', required: false }
  ],
  // TRAINING_DOC: #trainingDocForm (Đào Tạo > Kho Tài Liệu > Thêm Tài Liệu Vào Kho). tdCategory optionsKey
  // trỏ DB.trainingCategories (cùng nguồn tcCategory/tccCategory ở trên). tdMandatory (checkbox "⚠️ Bắt
  // Buộc Hoàn Thành") KHÔNG đưa vào — <label> BỌC NGOÀI chính input checkbox
  // (<label><input id="tdMandatory">...</label>, không phải label SIBLING trong div dùng chung như mọi
  // field khác) nên applyCoreFieldCustomizations() (input.closest('div')?.querySelector('label')) sẽ
  // tìm ra ĐÚNG label đó rồi ghi đè labelEl.innerHTML — xoá mất luôn <input> con bên trong, làm biến mất
  // hẳn checkbox khỏi DOM ngay từ lúc tải trang. Khác lỗi div-wrapping (nhãn lân cận bị ghi đè nhầm) đã
  // vá ở Đợt 1/3 — đây là field DUY NHẤT có cấu trúc ngược (label cha, input con) trong toàn app, không
  // đáng sửa lại markup chỉ để thêm 1 field phụ, nên loại khỏi manifest thay vì bọc lại. tdFile/
  // tdFileLabel KHÔNG đưa vào — nhãn bị onTrainingDocTypeChange() tự đổi qua lại "Tệp Tài Liệu"/"Ảnh Tài
  // Liệu" theo #tdDocType (cùng lý do tcDocumentIds ở Đợt 3, dù trigger là người dùng tự đổi dropdown chứ
  // không tự động mỗi lần vào lại module — vẫn cùng bản chất "nhãn bị JS khác ghi đè", tránh xung đột với
  // tùy biến admin). tdVideoUrl vẫn đưa vào bình thường — label field này CỐ ĐỊNH ("Link Video Youtube"),
  // chỉ có .required bị onTrainingDocTypeChange() bật/tắt theo #tdDocType lúc runtime — cùng khuôn
  // contractFile/offQty/offAmount/paymentSourceRecord (đã có sẵn trong manifest từ Đợt 1/2, cũng bị JS
  // khác toggle .required tương tự), không phải trường hợp ngoại lệ mới.
  TRAINING_DOC: [
    { id: 'tdCategory', label: 'Loại Đào Tạo', required: true, optionsKey: 'trainingCategories' },
    { id: 'tdTitle', label: 'Tên Tài Liệu', required: true },
    { id: 'tdDocType', label: 'Loại Tài Liệu', required: false },
    { id: 'tdCourseId', label: 'Chương Trình (tuỳ chọn)', required: false },
    { id: 'tdVideoUrl', label: 'Link Video Youtube', required: false },
    { id: 'tdDescription', label: 'Mô Tả (tuỳ chọn)', required: false }
  ],
  // CAREER_PATH: #careerPathForm (Đào Tạo > Lộ Trình Thăng Tiến > Tạo Lộ Trình Thăng Tiến Mới). Khối
  // "Các Cấp Bậc" (cpStageBuilderContainer, addCpStageRow()) KHÔNG đưa vào — hàng động do người dùng tự
  // thêm/bớt lúc tạo lộ trình, không phải field cố định có id ổn định, cùng lý do
  // operationOrderItemsTableBody/budgetEntries đã loại ở Đợt 2/3.
  CAREER_PATH: [
    { id: 'cpName', label: 'Tên Lộ Trình', required: true },
    { id: 'cpTargetTitle', label: 'Chức Danh Mục Tiêu (tuỳ chọn)', required: false },
    { id: 'cpDescription', label: 'Mô Tả', required: false }
  ],
  // ONBOARDING_PATH: #onboardingPathForm (Đào Tạo > Đào Tạo Tân Binh > Quản Lý Lộ Trình Đào Tạo Tân Binh).
  // opStage1/2RequiredCourseIds là <select multiple> tham chiếu trainingCourses (không phải danh sách
  // nhãn cố định) nên KHÔNG có optionsKey, cùng lý do tpCourseId ở trên.
  ONBOARDING_PATH: [
    { id: 'opName', label: 'Tên Lộ Trình', required: true },
    { id: 'opStage1RequiredCourseIds', label: 'Chương Trình Học Bắt Buộc Giai Đoạn 1 (Ngày 1-7, giữ Ctrl/Cmd để chọn nhiều)', required: true },
    { id: 'opStage2RequiredCourseIds', label: 'Chương Trình Học Bắt Buộc Giai Đoạn 2 (Ngày 8-21, giữ Ctrl/Cmd để chọn nhiều)', required: true },
    { id: 'opStage3Criteria', label: 'Tiêu Chí Đánh Giá Giai Đoạn 3 (Ngày 59, quản lý trực tiếp đánh giá — không có bài test)', required: false }
  ],
  // ONBOARDING_ASSIGN: #onboardingAssignForm (Đào Tạo > Đào Tạo Tân Binh > Phân Công Lộ Trình Cho Nhân
  // Viên Mới) — LÀ 1 <div> (không phải <form>, nút "Phân Công" data-op gọi thẳng
  // submitOnboardingAssignment() thay vì data-op-submit), nhưng vẫn là DOM TĨNH có sẵn từ lúc tải trang
  // (chỉ classList.toggle('hidden') theo quyền ở renderTrainingLms(), KHÔNG render lại qua innerHTML) —
  // KHÔNG rơi vào diện ngoại lệ như OPERATION_EXECUTION_PERIOD, applyAllCoreFieldCustomizations() 1 lần
  // lúc initDatabase() là đủ, không cần call site riêng.
  ONBOARDING_ASSIGN: [
    { id: 'oaEmployeeInput', label: 'Nhân Viên', required: false },
    { id: 'oaPathId', label: 'Lộ Trình', required: false }
  ],
  // TRAINING_CLASS_EDIT: #trainingEditClassForm (modal "✏️ Sửa Lớp Học", mở từ bảng Lớp Học qua
  // openEditTrainingClassModal()) — gap-fill phát hiện qua audit toàn app (đếm lại TOÀN BỘ <form id=...
  // data-op-submit=...> thật trong file: 25 form, 24/25 đã có coreKey qua Đợt 1-4, CHỈ CÒN đúng form
  // này). Là bản SỬA riêng biệt của TRAINING_CLASS (id khác hẳn, prefix "te" thay vì "tc", có
  // teInstructorFieldWrap/teLocationFieldWrap ẩn/hiện tĩnh theo c.mode SẴN CÓ của lớp — KHÔNG có ô đổi
  // #tcMode như form Tạo Mới, xem chú thích ngay tại markup #trainingEditClassModal), nên KHÔNG dùng
  // chung override với tcXxx được — cần 1 coreKey riêng, đúng khuôn "form tạo mới + form sửa là 2 bộ
  // field độc lập" đã áp dụng cho mọi module khác trong toàn hệ thống. teDocumentIds (Giáo Trình) ĐƯA VÀO
  // ĐƯỢC (khác tcDocumentIds bị loại ở Đợt 3) — nhãn field này CỐ ĐỊNH ở form Sửa, không có hàm nào tự
  // đổi qua lại theo mode (mode đã khoá, không đổi được sau khi tạo).
  TRAINING_CLASS_EDIT: [
    { id: 'teCategory', label: 'Loại Đào Tạo', required: true, optionsKey: 'trainingCategories' },
    { id: 'teTitle', label: 'Tên Lớp Học', required: true },
    { id: 'teInstructor', label: 'Giảng Viên / Người Phụ Trách', required: false },
    { id: 'teCourseId', label: 'Chương Trình (tuỳ chọn)', required: false },
    { id: 'teStart', label: 'Thời Gian Bắt Đầu', required: true },
    { id: 'teEnd', label: 'Thời Gian Kết Thúc', required: false },
    { id: 'teLocation', label: 'Địa Điểm / Hình Thức', required: false },
    { id: 'teDeadline', label: 'Hạn Đăng Ký', required: false },
    { id: 'teCapacity', label: 'Số Lượng Tối Đa (để trống = không giới hạn)', required: false },
    { id: 'tePassScore', label: 'Điểm Đạt Yêu Cầu (%) — bắt buộc nếu có gán Bài Test', required: false },
    { id: 'teTestId', label: 'Bài Test Gán Cho Lớp', required: false },
    { id: 'teTestSecondsPerQuestion', label: 'Số Giây / Câu Hỏi', required: false },
    { id: 'teDocumentIds', label: 'Giáo Trình (chọn từ Kho Tài Liệu, giữ Ctrl/Cmd để chọn nhiều)', required: false },
    { id: 'teDescription', label: 'Mô Tả / Nội Dung', required: false }
  ]
};

// Danh sách các tab của module Biểu mẫu: key trong DB.formTemplates (trường bổ sung) có thể khác
// với key trong CORE_FIELD_MANIFEST (trường mặc định) — ví dụ 3 phân hệ Văn phòng dùng chung 1 form
// (và chung 1 bộ trường mặc định 'OFFICE') nhưng mỗi phân hệ có bộ trường bổ sung riêng.
const FORM_TABS = [
  { key: 'SUBMISSION', coreKey: 'SUBMISSION', group: 'SUBMISSION', label: 'Văn Bản Trình / Tờ Trình', icon: '📜', short: 'Tờ Trình' },
  // Hợp Đồng TÁCH 2 bộ trường bổ sung riêng theo đúng 2 sub-tab (Phê Duyệt / Quản Lý HĐ &amp; Giấy
  // Phép) — cùng chung 1 coreKey 'CONTRACT' (trường mặc định là các field DOM dùng chung giữa 2 sub-tab
  // nên vẫn sửa nhãn/bắt buộc chung), nhưng key riêng để mỗi bên có DANH SÁCH TRƯỜNG BỔ SUNG khác nhau.
  // CONTRACT_APPROVAL áp cho chế độ Tạo Mới/Bổ Sung Phụ Lục (renderDynamicInputsForModule() gọi tuỳ
  // theo contractOpMode, xem onContractOpModeChange()); CONTRACT_MANAGE áp cho chế độ Nhập Đã Ký VÀ
  // cho bước "Tải Tài Liệu Ký" riêng (modal #signedUploadModal, xem openSignedUploadModal()).
  { key: 'CONTRACT_APPROVAL', coreKey: 'CONTRACT', group: 'CONTRACT', label: 'Hợp Đồng - Phê Duyệt', icon: '📄', short: 'HĐ - Phê Duyệt' },
  { key: 'CONTRACT_MANAGE', coreKey: 'CONTRACT', group: 'CONTRACT', label: 'Hợp Đồng - Quản Lý HĐ & Giấy Phép', icon: '📋', short: 'HĐ - Quản Lý' },
  { key: 'CAR', coreKey: 'CAR', group: 'CAR', label: 'Đăng Ký Xe', icon: '🚗', short: 'Đăng Ký Xe' },
  { key: 'MUA_BAN', coreKey: 'OFFICE', group: 'OFFICE', label: 'Văn Phòng - Mua Bán', icon: '🛒', short: 'Mua Bán' },
  { key: 'SUA_CHUA', coreKey: 'OFFICE', group: 'OFFICE', label: 'Văn Phòng - Sửa Chữa', icon: '🔧', short: 'Sửa Chữa' },
  { key: 'DOC', coreKey: 'DOC', group: 'DOC', label: 'Tài Liệu', icon: '📁', short: 'Tài Liệu' },
  { key: 'MEETING_MINUTES', coreKey: 'MEETING_MINUTES', group: 'MEETING_MINUTES', label: 'Biên Bản Họp', icon: '📝', short: 'Biên Bản Họp' },
  { key: 'MEETING_ROOM', coreKey: 'MEETING_ROOM', group: 'MEETING_ROOM', label: 'Đặt Phòng Họp', icon: '📅', short: 'Đặt Phòng' },
  { key: 'INTERNAL_POST', coreKey: 'INTERNAL_POST', group: 'INTERNAL_POST', label: 'Truyền Thông Nội Bộ - Chuyên Đề', icon: '📣', short: 'Chuyên Đề TTNB' },
  // Đợt 1 (mở rộng Biểu Mẫu ra thêm Công Việc/VPP/Giấy Phép/Hỗ Trợ IT) — mỗi tab key riêng TRÙNG coreKey
  // (module chỉ có 1 bộ trường mặc định/1 form, không tách theo sub-tab như CONTRACT/OFFICE ở trên).
  { key: 'TASK', coreKey: 'TASK', group: 'TASK', label: 'Công Việc - Giao Việc', icon: '📌', short: 'Công Việc' },
  { key: 'VPP', coreKey: 'VPP', group: 'VPP', label: 'Văn Phòng Phẩm - Tạo Kỳ Đăng Ký', icon: '🖇️', short: 'VPP' },
  { key: 'LICENSE', coreKey: 'LICENSE', group: 'LICENSE', label: 'Giấy Phép', icon: '📜', short: 'Giấy Phép' },
  { key: 'IT_PRICE', coreKey: 'IT_PRICE', group: 'IT', label: 'Hỗ Trợ IT - Đề Xuất Duyệt Giá', icon: '🏷️', short: 'IT - Duyệt Giá' },
  { key: 'IT_TICKET', coreKey: 'IT_TICKET', group: 'IT', label: 'Hỗ Trợ IT - Yêu Cầu Hỗ Trợ', icon: '🎫', short: 'IT - Yêu Cầu' },
  // Đợt 2 (mở rộng Biểu Mẫu ra thêm Thanh Toán/Ngân Sách/Báo Cáo Định Kỳ/Đồng Phục) — mỗi tab key riêng
  // TRÙNG coreKey (như Đợt 1), trừ Đồng Phục có 5 form thật riêng biệt nên 5 coreKey/tab riêng.
  { key: 'PAYMENT', coreKey: 'PAYMENT', group: 'PAYMENT', label: 'Thanh Toán', icon: '💰', short: 'Thanh Toán' },
  { key: 'BUDGET_PERIOD', coreKey: 'BUDGET_PERIOD', group: 'BUDGET', label: 'Ngân Sách - Tạo Kỳ', icon: '📅', short: 'NS - Tạo Kỳ' },
  { key: 'BUDGET_TEMPLATE', coreKey: 'BUDGET_TEMPLATE', group: 'BUDGET', label: 'Ngân Sách - Mẫu Ngân Sách', icon: '🧩', short: 'NS - Mẫu' },
  { key: 'REPORT_ENTRY', coreKey: 'REPORT_ENTRY', group: 'REPORT', label: 'Báo Cáo Định Kỳ - Nhập Báo Cáo', icon: '📝', short: 'BCĐK - Nhập' },
  { key: 'REPORT_PERIOD', coreKey: 'REPORT_PERIOD', group: 'REPORT', label: 'Báo Cáo Định Kỳ - Tạo Kỳ', icon: '📅', short: 'BCĐK - Tạo Kỳ' },
  { key: 'UNIFORM_PERIOD', coreKey: 'UNIFORM_PERIOD', group: 'UNIFORM', label: 'Đồng Phục - Tạo Kỳ Cấp Phát', icon: '📦', short: 'ĐP - Tạo Kỳ' },
  { key: 'UNIFORM_ISSUE', coreKey: 'UNIFORM_ISSUE', group: 'UNIFORM', label: 'Đồng Phục - Cấp Cho Nhân Viên', icon: '👕', short: 'ĐP - Cấp Phát' },
  { key: 'UNIFORM_ADJUST_STOCK', coreKey: 'UNIFORM_ADJUST_STOCK', group: 'UNIFORM', label: 'Đồng Phục - Báo Hỏng/Hủy (Kho)', icon: '🗑️', short: 'ĐP - Báo Hỏng Kho' },
  { key: 'UNIFORM_ADJUST_EMPLOYEE', coreKey: 'UNIFORM_ADJUST_EMPLOYEE', group: 'UNIFORM', label: 'Đồng Phục - Thu Hồi Từ Nhân Viên', icon: '↩️', short: 'ĐP - Thu Hồi' },
  { key: 'UNIFORM_TRANSFER', coreKey: 'UNIFORM_TRANSFER', group: 'UNIFORM', label: 'Đồng Phục - Điều Chuyển Kho', icon: '🔁', short: 'ĐP - Điều Chuyển' },
  // Đợt 3 (mở rộng Biểu Mẫu ra thêm Vận Hành/Đào Tạo/Tuyển Dụng + 1 gap-fill HCRC Đồng Hành phát hiện
  // qua audit BUSINESS_MODULES) — mỗi tab key riêng TRÙNG coreKey, cùng khuôn Đợt 1/2.
  { key: 'OPERATION_ORDER', coreKey: 'OPERATION_ORDER', group: 'OPERATION', label: 'Vận Hành - Phê Duyệt Đơn Hàng', icon: '📦', short: 'VH - Đơn Hàng' },
  { key: 'OPERATION_STORE_OPEN', coreKey: 'OPERATION_STORE_OPEN', group: 'OPERATION', label: 'Vận Hành - Mở Mới Siêu Thị', icon: '🏬', short: 'VH - Mở Mới' },
  { key: 'OPERATION_REPAIR', coreKey: 'OPERATION_REPAIR', group: 'OPERATION', label: 'Vận Hành - Sửa Chữa Siêu Thị', icon: '🔧', short: 'VH - Sửa Chữa' },
  { key: 'OPERATION_WORK_ITEM', coreKey: 'OPERATION_WORK_ITEM', group: 'OPERATION', label: 'Vận Hành - Thêm Công Việc (Thực Hiện/Nghiệm Thu)', icon: '🛠️', short: 'VH - Công Việc' },
  { key: 'TRAINING_CLASS', coreKey: 'TRAINING_CLASS', group: 'TRAINING', label: 'Đào Tạo - Tạo Lớp Học', icon: '🎓', short: 'ĐT - Lớp Học' },
  { key: 'TRAINING_TEST', coreKey: 'TRAINING_TEST', group: 'TRAINING', label: 'Đào Tạo - Ngân Hàng Câu Hỏi', icon: '🧪', short: 'ĐT - Bài Test' },
  { key: 'RECRUITMENT_JOB', coreKey: 'RECRUITMENT_JOB', group: 'RECRUITMENT', label: 'Tuyển Dụng - Đăng Tin', icon: '💼', short: 'TD - Đăng Tin' },
  { key: 'RECRUITMENT_REFERRAL', coreKey: 'RECRUITMENT_REFERRAL', group: 'RECRUITMENT', label: 'Tuyển Dụng - Giới Thiệu Ứng Viên', icon: '🙋', short: 'TD - Giới Thiệu' },
  { key: 'HR_FEEDBACK', coreKey: 'HR_FEEDBACK', group: 'HR_FEEDBACK', label: 'HCRC Đồng Hành - Gửi Câu Hỏi', icon: '🤝', short: 'HCRC Đồng Hành' },
  // 'OPERATION_EXECUTION_PERIOD' (Vận Hành - Tạo Kỳ Thực Hiện) đã BỎ khỏi đây — đợt "Danh Mục Đầu Tư +
  // bỏ Tạo Kỳ", xem chú thích ở CORE_FIELD_MANIFEST phía trên.
  { key: 'IT_RENEWAL', coreKey: 'IT_RENEWAL', group: 'IT', label: 'Hỗ Trợ IT - Gia Hạn Dịch Vụ', icon: '🔔', short: 'IT - Gia Hạn' },
  // Đợt 4 (nốt các form Đào Tạo còn lại: Chương Trình/Kế Hoạch/Kho Tài Liệu/Lộ Trình Thăng Tiến/Đào Tạo
  // Tân Binh) — mỗi tab key riêng TRÙNG coreKey, cùng khuôn Đợt 1/2/3.
  { key: 'TRAINING_COURSE', coreKey: 'TRAINING_COURSE', group: 'TRAINING', label: 'Đào Tạo - Tạo Chương Trình', icon: '📚', short: 'ĐT - Chương Trình' },
  { key: 'TRAINING_PLAN', coreKey: 'TRAINING_PLAN', group: 'TRAINING', label: 'Đào Tạo - Kế Hoạch Đào Tạo', icon: '🗓️', short: 'ĐT - Kế Hoạch' },
  { key: 'TRAINING_DOC', coreKey: 'TRAINING_DOC', group: 'TRAINING', label: 'Đào Tạo - Kho Tài Liệu', icon: '📁', short: 'ĐT - Kho Tài Liệu' },
  { key: 'CAREER_PATH', coreKey: 'CAREER_PATH', group: 'TRAINING', label: 'Đào Tạo - Lộ Trình Thăng Tiến', icon: '🪜', short: 'ĐT - Lộ Trình' },
  { key: 'ONBOARDING_PATH', coreKey: 'ONBOARDING_PATH', group: 'TRAINING', label: 'Đào Tạo Tân Binh - Quản Lý Lộ Trình', icon: '🎒', short: 'Tân Binh - Lộ Trình' },
  { key: 'ONBOARDING_ASSIGN', coreKey: 'ONBOARDING_ASSIGN', group: 'TRAINING', label: 'Đào Tạo Tân Binh - Phân Công', icon: '📋', short: 'Tân Binh - Phân Công' },
  // Gap-fill phát hiện qua audit toàn app (đếm lại 25 <form data-op-submit> thật trong file — xem chú
  // thích tại CORE_FIELD_MANIFEST.TRAINING_CLASS_EDIT).
  { key: 'TRAINING_CLASS_EDIT', coreKey: 'TRAINING_CLASS_EDIT', group: 'TRAINING', label: 'Đào Tạo - Sửa Lớp Học', icon: '✏️', short: 'ĐT - Sửa Lớp Học' }
];

// Nhóm module CẤP 1 cho thanh tab Biểu Mẫu (mirror WF_MODULE_CONFIG/renderWfSubmissionTypeTabs bên màn
// "Quy Trình & Phê Duyệt" — xem switchWfModule()/getWfModuleTypes()): 33+ tab FORM_TABS phẳng trước đây
// gộp thành ~20 nhóm nghiệp vụ thật ở đây, mỗi FORM_TABS entry khai `group` trỏ về 1 key trong danh sách
// này. Nhóm chỉ có ĐÚNG 1 form (VD DOC, TASK, PAYMENT...) hành xử như module KHÔNG hasTypes bên WF —
// bấm nút cấp 1 vào thẳng form đó, không hiện hàng tab con cấp 2. Nhóm có >1 form (VD CONTRACT, IT,
// TRAINING...) hiện thêm hàng tab con cấp 2 liệt kê đúng các FORM_TABS entry thuộc nhóm — xem
// renderFormTabsBar()/renderFormSubTabsBar()/switchFormGroup()/switchFormTab() ngay dưới đây. Thứ tự
// mảng này quyết định thứ tự nút cấp 1 hiển thị.
const FORM_GROUPS = [
  { key: 'SUBMISSION', label: 'Văn Bản Trình', icon: '📜' },
  { key: 'CONTRACT', label: 'Hợp Đồng', icon: '📄' },
  { key: 'CAR', label: 'Đăng Ký Xe', icon: '🚗' },
  { key: 'OFFICE', label: 'Văn Phòng', icon: '🛒' },
  { key: 'DOC', label: 'Tài Liệu', icon: '📁' },
  { key: 'MEETING_MINUTES', label: 'Biên Bản Họp', icon: '📝' },
  { key: 'MEETING_ROOM', label: 'Đặt Phòng Họp', icon: '📅' },
  { key: 'INTERNAL_POST', label: 'Truyền Thông Nội Bộ', icon: '📣' },
  { key: 'TASK', label: 'Công Việc', icon: '📌' },
  { key: 'VPP', label: 'Văn Phòng Phẩm', icon: '🖇️' },
  { key: 'LICENSE', label: 'Giấy Phép', icon: '📜' },
  { key: 'IT', label: 'Hỗ Trợ IT', icon: '🏷️' },
  { key: 'PAYMENT', label: 'Thanh Toán', icon: '💰' },
  { key: 'BUDGET', label: 'Ngân Sách', icon: '📊' },
  { key: 'REPORT', label: 'Báo Cáo Định Kỳ', icon: '📈' },
  { key: 'UNIFORM', label: 'Đồng Phục', icon: '👕' },
  { key: 'OPERATION', label: 'Vận Hành', icon: '🛠️' },
  { key: 'TRAINING', label: 'Đào Tạo', icon: '🎓' },
  { key: 'RECRUITMENT', label: 'Tuyển Dụng', icon: '💼' },
  { key: 'HR_FEEDBACK', label: 'HCRC Đồng Hành', icon: '🤝' }
];

function getFormTabsInGroup(groupKey) {
  return FORM_TABS.filter(t => t.group === groupKey);
}

function getFormGroupForTab(tabKey) {
  const tab = FORM_TABS.find(t => t.key === tabKey);
  return tab ? tab.group : null;
}

// Trả về (và khởi tạo nếu chưa có) đối tượng override {fieldId: {label, required}} của các trường
// mặc định thuộc 1 bộ core-field (SUBMISSION/CONTRACT/CAR/OFFICE/DOC/MEETING_MINUTES/MEETING_ROOM).
function getCoreFieldOverrides(coreKey) {
  const storeKey = '__core__' + coreKey;
  if (!DB.formTemplates[storeKey]) DB.formTemplates[storeKey] = {};
  return DB.formTemplates[storeKey];
}

// Áp dụng nhãn hiển thị + bắt buộc nhập đã tùy biến (nếu có) lên form nghiệp vụ thật.
// Nếu trường không có <label> riêng (VD: input dùng placeholder làm nhãn) thì cập nhật placeholder.
function applyCoreFieldCustomizations(coreKey) {
  const manifest = CORE_FIELD_MANIFEST[coreKey];
  if (!manifest) return;
  const overrides = getCoreFieldOverrides(coreKey);
  manifest.forEach(f => {
    const input = document.getElementById(f.id);
    if (!input) return;
    const override = overrides[f.id] || {};
    const label = (typeof override.label === 'string' && override.label.trim()) ? override.label.trim() : f.label;
    const required = ('required' in override) ? !!override.required : f.required;
    input.required = required;
    const labelEl = input.closest('div')?.querySelector('label');
    if (labelEl) {
      labelEl.innerHTML = escapeHtml(label) + (required ? ' <span class="text-red-500">*</span>' : '');
    } else if ('placeholder' in input) {
      input.placeholder = label;
    }
  });
}

function applyAllCoreFieldCustomizations() {
  Object.keys(CORE_FIELD_MANIFEST).forEach(applyCoreFieldCustomizations);
}

function updateCoreFieldOverride(coreKey, fieldId, prop, value) {
  const overrides = getCoreFieldOverrides(coreKey);
  if (!overrides[fieldId]) overrides[fieldId] = {};
  overrides[fieldId][prop] = value;
  syncStorage('formTemplates');
  applyCoreFieldCustomizations(coreKey);
  logSystemAction('CONFIG', 'UPDATE_CORE_FIELD', `Cập nhật thuộc tính "${prop}" của trường mặc định [${fieldId}] (${coreKey})`, 'SUCCESS', fieldId);
}
// CSP: onchange checkbox chỉ truyền được phần tử qua data-arg-el (không có slot "this.checked" — xem
// cspReadArgSlot), nên tách riêng wrapper đọc .checked từ phần tử rồi mới gọi hàm lõi ở trên (hàm lõi
// giữ nguyên chữ ký cũ nhận thẳng prop/value).
function updateCoreFieldOverrideFromCheckbox(coreKey, fieldId, prop, checkboxEl) {
  updateCoreFieldOverride(coreKey, fieldId, prop, checkboxEl.checked);
}
// CSP: ô sửa nhãn field mặc định trước đây tính fallback ngay trong oninput
// (this.value.trim() || '<nhãn gốc>') — biểu thức JS không phải lệnh gọi hàm đơn nên data-arg-value
// không thay thế được, tách riêng wrapper nhận defaultLabel qua data-arg2 rồi tự tính fallback từ
// phần tử input qua data-arg-el.
function updateCoreFieldOverrideLabelFromInput(coreKey, fieldId, defaultLabel, inputEl) {
  updateCoreFieldOverride(coreKey, fieldId, 'label', inputEl.value.trim() || defaultLabel);
}

// Lấy danh sách nhãn hiển thị hiện tại của 1 trường mặc định kiểu dropdown "danh sách lựa chọn cố
// định" (subType/contractType/carType — xem CORE_FIELD_MANIFEST optionsKey). Luôn trả mảng nhãn
// (string) dù dữ liệu gốc là {key,label}[] (optionsIsKeyLabel:true) hay chuỗi phẳng.
function getCoreFieldOptionsList(fieldDef) {
  if (!fieldDef.optionsKey) return [];
  const list = DB[fieldDef.optionsKey] || [];
  return fieldDef.optionsIsKeyLabel ? list.map(x => x.label) : list.slice();
}

// Lưu lại danh sách lựa chọn mới cho 1 trường mặc định kiểu dropdown. Với danh sách dạng {key,label}[]
// (optionsIsKeyLabel:true — hiện chỉ submissionTypes), GIỮ NGUYÊN key cũ cho nhãn không đổi (tránh làm
// mồ côi submissionTypeDeptWorkflows đang tra theo key), chỉ sinh key mới cho nhãn thực sự mới.
function saveCoreFieldOptionsList(fieldDef, newLabels) {
  if (fieldDef.optionsIsKeyLabel) {
    const existing = DB[fieldDef.optionsKey] || [];
    const usedKeys = new Set();
    DB[fieldDef.optionsKey] = newLabels.map(label => {
      const match = existing.find(e => e.label === label && !usedKeys.has(e.key));
      if (match) { usedKeys.add(match.key); return match; }
      let base = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'LOAI';
      let key = base, n = 1;
      while (existing.some(e => e.key === key) || usedKeys.has(key)) key = `${base}_${++n}`;
      usedKeys.add(key);
      return { key, label };
    });
  } else {
    DB[fieldDef.optionsKey] = newLabels.slice();
  }
  syncStorage(fieldDef.optionsKey);
  populateDropdowns();
}

// ==========================================
// THỨ TỰ HIỂN THỊ THỐNG NHẤT (mặc định + bổ sung TRỘN LẪN, sắp xếp tự do) — mảng id, lưu ở
// DB.formTemplates['__order__'+tabKey]. Trước đây trường mặc định LUÔN đứng trước (đúng thứ tự khai ở
// CORE_FIELD_MANIFEST), trường bổ sung LUÔN đứng sau (chỉ tự sắp xếp được với nhau) — giờ gộp 1 danh
// sách duy nhất, admin kéo bất kỳ trường nào (kể cả mặc định) tới vị trí bất kỳ. Cách áp dụng: CHỈ set
// CSS `order` lên khối bọc (div) của từng trường trên form nghiệp vụ thật — KHÔNG di chuyển gì trong cây
// DOM — nên không đụng bất kỳ logic đọc/ghi nào đang tra theo id (querySelector/closest/required...),
// xem applyFieldOrder() ngay dưới.
function getUnifiedFieldOrder(tabKey) {
  const tab = FORM_TABS.find(t => t.key === tabKey);
  const coreIds = tab && CORE_FIELD_MANIFEST[tab.coreKey] ? CORE_FIELD_MANIFEST[tab.coreKey].map(f => f.id) : [];
  const customIds = (DB.formTemplates[tabKey] || []).map(f => f.id);
  const defaultOrder = [...coreIds, ...customIds];
  const saved = DB.formTemplates['__order__' + tabKey];
  if (!Array.isArray(saved)) return defaultOrder;
  // Trường nào có mặt THẬT trong core/custom hiện tại nhưng chưa có trong mảng đã lưu (mới thêm sau lúc
  // admin từng sắp xếp) -> vẫn phải hiện, đưa xuống cuối theo đúng thứ tự mặc định — không bao giờ để
  // "rơi mất" 1 trường khỏi form thật chỉ vì nó chưa có mặt trong mảng thứ tự đã lưu. Ngược lại, id đã lưu
  // nhưng không còn tồn tại (trường bổ sung đã bị xóa) tự động bị lọc bỏ luôn ở đây.
  const validIds = new Set(defaultOrder);
  const validSaved = saved.filter(id => validIds.has(id));
  const savedSet = new Set(validSaved);
  const missing = defaultOrder.filter(id => !savedSet.has(id));
  return [...validSaved, ...missing];
}

function setUnifiedFieldOrder(tabKey, orderArr) {
  DB.formTemplates['__order__' + tabKey] = orderArr;
  syncStorage('formTemplates');
}

function moveUnifiedField(tabKey, fieldId, direction) {
  const arr = getUnifiedFieldOrder(tabKey);
  const idx = arr.indexOf(fieldId);
  const swapWith = idx + direction;
  if (idx < 0 || swapWith < 0 || swapWith >= arr.length) return;
  [arr[idx], arr[swapWith]] = [arr[swapWith], arr[idx]];
  setUnifiedFieldOrder(tabKey, arr);
  logSystemAction('CONFIG', 'REORDER_FIELD', `Đổi vị trí trường [${fieldId}] trong biểu mẫu ${tabKey}`, 'SUCCESS', fieldId);
  renderFormFieldsTable();
}

// Áp thứ tự đã lưu lên form nghiệp vụ THẬT — gọi lại mỗi khi form hiện ra/đổi tab con VÀ ngay sau mỗi lần
// renderDynamicInputsForModule(tabKey,...) (trường bổ sung vừa được vẽ lại thì phải áp order lại luôn).
// Trường mặc định: tìm khối bọc qua document.getElementById(id).closest('div') — ĐÚNG khuôn
// applyCoreFieldCustomizations() đang dùng, đảm bảo luôn trỏ cùng 1 khối. Trường bổ sung: tìm qua
// [data-field-order-id="id"] (gắn ở renderDynamicInputsForModule()).
function applyFieldOrder(tabKey) {
  const order = getUnifiedFieldOrder(tabKey);
  order.forEach((id, idx) => {
    const core = document.getElementById(id);
    const wrap = core ? core.closest('div') : document.querySelector(`[data-field-order-id="${CSS.escape(id)}"]`);
    if (wrap) wrap.style.order = idx;
  });
}
// Tài liệu GỐC đang mở rộng (hiện các version con) trong "Danh Sách Tài Liệu Trong Hệ Thống" — id của
// tài liệu gốc, xem toggleDocFamily()/renderDocs().
let expandedDocFamilies = new Set();
let expandedLicenseFamilies = new Set();
let activeContractSubTab = 'APPROVAL';
let activePaymentSubTab = 'APPROVE';
let expandedContractFamilies = new Set();
let currentProcessingSubId = null;
let currentProcessingCarId = null;
let carRoutePoints = ['', ''];
let activeCarSubTab = 'REG';
let currentProcessingOfficeId = null;
// Tệp .docx đang mở trong Khung Xem Bảo Vệ (nếu có) — dùng cho nút "In có watermark" (xem
// printWordWithWatermark() ở script cuối trang), reset về null mỗi lần openFileProtectedView() xử lý 1
// tệp KHÔNG phải Word để nút không vô tình dùng nhầm tệp của lượt xem trước.
let currentWordPrintFile = null;
// Danh sách hạng mục của phiếu Đề Nghị Mua Sắm đang nhập (theo Mẫu BM-TS01) — reset mỗi khi
// submit thành công hoặc chuyển sang phân hệ Mua Sắm.
let officeItems = [];
// Danh sách dòng "Ý kiến chỉ đạo" của Biên bản họp đang nhập/sửa — mỗi dòng có thể gán ngay cho 1
// người cụ thể (nguồn dữ liệu để Phase 3 tạo Công việc từ chỉ đạo).
let minutesDirectives = [];
// Danh sách dòng "Thành phần tham dự" đang nhập/sửa — mỗi dòng gồm Họ tên/Chức danh/Phòng/SĐT/Email,
// có id ổn định riêng (genAttendeeId) để Ý kiến chỉ đạo tham chiếu tới đúng người, không phụ thuộc
// việc khớp tên với tài khoản hệ thống — Người thực hiện/phối hợp lấy trực tiếp từ danh sách này.
let minutesAttendeesRows = [];
function genAttendeeId() { return `${Date.now()}-${Math.floor(Math.random() * 100000)}`; }
// id ổn định riêng cho từng dòng "Ý kiến chỉ đạo" — để Công việc sinh ra từ 1 dòng chỉ đạo cụ thể tra
// ngược lại ĐÚNG dòng đó (Task.sourceDirectiveId) khi biên bản có nhiều hơn 1 chỉ đạo, phục vụ hiện
// trạng thái/tiến độ trực tiếp trong "Xem chi tiết" biên bản (xem viewMeetingMinutesDetails()).
function genMinutesDirectiveId() { return `dir-${Date.now()}-${Math.floor(Math.random() * 100000)}`; }

// Tra cứu 1 người trong Thành phần tham dự theo id ổn định — dùng cho cả lúc đang nhập biên bản (đọc
// từ minutesAttendeesRows, phản ứng ngay khi sửa/thêm/xoá người tham dự) lẫn sau khi đã lưu (đọc từ
// m.attendees đã chốt). Liên kết tài khoản hệ thống (username) đọc THẲNG từ cột "Tài khoản" đã xác
// nhận lúc nhập (a.hasAccount/a.username — xem applyAttendeeSystemUser()/resolveAttendeeAccountInput()),
// KHÔNG dò tên mơ hồ ở đây nữa — tránh khớp nhầm khi nhiều người trùng tên. Không có tài khoản (hoặc
// Tài khoản = Không) -> username null — Công việc vẫn tạo được bình thường ("người thực hiện ngoài hệ
// thống"), người giao việc/admin thao tác thay (Nhận việc thay/Cập nhật tiến độ) vì họ không đăng nhập
// được. Email thông báo LUÔN lấy đúng email đã nhập ở Thành phần tham dự, không fallback về email hệ thống.
function resolveDirectiveAttendee(attendeesList, attendeeId) {
  if (!attendeeId) return null;
  const a = (attendeesList || []).find(x => String(x.id) === String(attendeeId));
  if (!a || !(a.name || '').trim()) return null;
  return { name: a.name.trim(), email: (a.email || '').trim(), username: a.hasAccount === 'YES' ? (a.username || null) : null };
}

// Danh sách phòng họp — nguồn dữ liệu DUY NHẤT dùng chung cho cả <select> đăng ký lẫn lưới Lịch Họp,
// tránh lệch dữ liệu giữa 2 nơi. "short" dùng làm tiêu đề cột gọn trên lưới.
const MEETING_ROOMS = [
  { name: 'Phòng Họp Lớn A (Tầng 3 - Sức chứa 50 người)', short: 'Phòng A (50 người)' },
  { name: 'Phòng Họp Nhỏ B (Tầng 2 - Sức chứa 15 người)', short: 'Phòng B (15 người)' },
  { name: 'Phòng Hội Thảo Trực Tuyến C (Tầng 5)', short: 'Phòng C (Online)' }
];
let activeMeetingSubTab = 'REGISTER';
// Khác null khi đang SỬA 1 biên bản đã tạo (thay vì tạo mới) — chỉ người tạo mới sửa được.
let editingMinutesId = null;
// Phân hệ đang chọn trong module Truyền thông nội bộ: NEWS/TRAINING/RECRUITMENT/SHARE.
let activeInternalSubTab = 'NEWS';
// Tab con đang chọn trong khối Tuyển Dụng (thay "Khen Thưởng" cũ): JOBS/MY_REFERRALS/MANAGE.
let activeRecruitmentTab = 'JOBS';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ==========================================
// Ô NHẬP TIỀN — tự chèn dấu phân cách hàng nghìn ngay khi gõ (class "money-input"), khớp đúng cách
// hiển thị tiền dùng chung toàn hệ thống (toLocaleString('vi-VN') — VD "100.000.000 VNĐ"), để ô nhập
// và mọi nơi hiển thị lại con số đó (bảng, phiếu duyệt, báo cáo) luôn cùng 1 định dạng. Các ô này khai
// type="text" inputmode="numeric" (không dùng type="number" vì trình duyệt không cho chèn dấu chấm
// vào input số) — giá trị SỐ THẬT để tính toán/gửi server PHẢI lấy qua getMoneyValue(), không đọc
// thẳng input.value (đã bị chèn dấu chấm hiển thị).
function formatMoneyDisplay(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return Number(digits).toLocaleString('vi-VN');
}

function getMoneyValue(input) {
  if (!input) return 0;
  return Number(String(input.value || '').replace(/\D/g, '')) || 0;
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !el.classList.contains('money-input')) return;
  const caretFromEnd = el.value.length - (el.selectionStart ?? el.value.length);
  el.value = formatMoneyDisplay(el.value);
  const pos = Math.max(0, el.value.length - caretFromEnd);
  el.setSelectionRange(pos, pos);
});

// ==========================================
// BỘ TÌM KIẾM / LỌC / PHÂN TRANG DÙNG CHUNG CHO MỌI MODULE DẠNG DANH SÁCH
// ==========================================
// Trước đây mỗi module tự viết lại toàn bộ logic lọc + phân trang (module Tài liệu là bản đầu
// tiên, ~150 dòng). Tách ra đây để mọi module (Tài liệu, Tờ trình, Hợp đồng, Xe, Văn phòng, Phòng
// họp, Log...) dùng chung 1 bộ — sửa 1 chỗ áp dụng toàn hệ thống, tránh lặp code.

// Trạng thái trang hiện tại + số dòng/trang, theo từng module (key tự đặt, không trùng nhau).
const listPageState = {};

function getListPageState(moduleKey) {
  if (!listPageState[moduleKey]) listPageState[moduleKey] = { page: 1, pageSize: 10 };
  return listPageState[moduleKey];
}

function resetListPage(moduleKey) {
  getListPageState(moduleKey).page = 1;
}

function goToListPage(moduleKey, page, renderFnName) {
  getListPageState(moduleKey).page = page;
  window[renderFnName]();
}

function changeListPageSize(moduleKey, val, renderFnName) {
  const st = getListPageState(moduleKey);
  st.pageSize = parseInt(val, 10) || 10;
  st.page = 1;
  window[renderFnName]();
}

// true nếu bất kỳ field nào trong danh sách chứa keyword (không phân biệt hoa/thường); keyword rỗng
// luôn khớp (không lọc gì).
function matchesKeywordFields(fields, keyword) {
  if (!keyword) return true;
  const kw = keyword.toLowerCase();
  return fields.some(f => (f || '').toString().toLowerCase().includes(kw));
}

// true nếu dateStr nằm trong khoảng [fromDate, toDate] (dạng yyyy-mm-dd từ input type=date); bỏ
// trống 1 hoặc cả 2 đầu = không giới hạn phía đó.
//
// dateStr trong hệ thống thường là chuỗi nowVN() ("hh:mm:ss dd/mm/yyyy", vd createdAt) — new Date(...)
// KHÔNG parse được định dạng này (trả về Invalid Date) nên trước đây isNaN() luôn true, hàm luôn trả
// về true (coi như "không lọc được nên giữ lại") cho MỌI bản ghi có dateStr kiểu này — bộ lọc khoảng
// ngày ở mọi báo cáo trong hệ thống thực chất KHÔNG lọc gì cả. Dùng parseVNDateTime() trước, chỉ khi
// đó không parse được (dateStr đã là ISO, vd startTime của input datetime-local) mới rơi về new Date().
// parseVNDateTime() - CHUYEN tu module-baocaoquantri.js sang day (Ha tang: nap module theo cum, dot 7):
// isInDateRange() ngay duoi day (dung chung cho bo loc khoang ngay o hau het module) va nhieu noi khac
// (core-approvalhub.js...) goi thang ham nay - khong the de nam o 1 file module-*.js duoc nap luoi.
// Parse nguoc chuoi "HH:MM:SS D/M/YYYY" do new Date().toLocaleString('vi-VN') sinh ra (dinh dang co
// dinh cua locale nay) - can thiet vi Date() khong tu parse lai duoc chuoi theo locale vi-VN.
function parseVNDateTime(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(' ');
  if (parts.length !== 2) return null;
  const [timePart, datePart] = parts;
  const timeBits = timePart.split(':').map(Number);
  const dateBits = datePart.split('/').map(Number);
  if (dateBits.length !== 3 || dateBits.some(isNaN)) return null;
  const [h, mi, s] = timeBits;
  const [d, mo, y] = dateBits;
  const dt = new Date(y, mo - 1, d, h || 0, mi || 0, s || 0);
  return isNaN(dt.getTime()) ? null : dt;
}

function isInDateRange(dateStr, fromDate, toDate) {
  if (!fromDate && !toDate) return true;
  const d = parseVNDateTime(dateStr) || new Date(dateStr);
  if (isNaN(d.getTime())) return true; // dữ liệu thiếu ngày thì không loại bỏ khỏi kết quả
  if (fromDate && d < new Date(fromDate)) return false;
  if (toDate && d > new Date(toDate + 'T23:59:59')) return false;
  return true;
}

// Dashboard thẻ-bấm-để-lọc dùng chung cho mọi module có phê duyệt (thay vì mỗi module tự viết tay
// 1 bản riêng — trước đây chỉ module Tài Liệu có, và bản viết tay đó từng lệch với isInDateRange()).
// cards: [{ key, label, count, colorClass }] — colorClass là 1 class border-l-* (vd 'border-l-amber-500').
// activeKey: giá trị filter đang được chọn (để tô viền nhấn thẻ tương ứng). onClickFnName: tên hàm
// global (chuỗi) sẽ được gọi với đúng 1 tham số là card.key khi bấm thẻ.
// Map tên màu (suy ra từ colorClass sẵn có kiểu 'border-l-{color}-500' của từng module) sang bộ class
// nền/viền/chữ đầy đủ — viết literal từng class ở đây (không nội suy chuỗi động) vì Tailwind chỉ grep
// text tìm chuỗi giống tên class trong file, không thực thi JS (xem tailwind.config.js).
const DASHBOARD_CARD_COLOR_MAP = {
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-300',   text: 'text-blue-700',   activeBg: 'bg-blue-100' },
  yellow: { bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-700', activeBg: 'bg-yellow-100' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700', activeBg: 'bg-orange-100' },
  green:  { bg: 'bg-green-50',  border: 'border-green-300',  text: 'text-green-700',  activeBg: 'bg-green-100' },
  red:    { bg: 'bg-red-50',    border: 'border-red-300',    text: 'text-red-700',    activeBg: 'bg-red-100' },
  indigo: { bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-700', activeBg: 'bg-indigo-100' },
  sky:    { bg: 'bg-sky-50',    border: 'border-sky-300',    text: 'text-sky-700',    activeBg: 'bg-sky-100' },
  amber:  { bg: 'bg-amber-50',  border: 'border-amber-300',  text: 'text-amber-700',  activeBg: 'bg-amber-100' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700', activeBg: 'bg-purple-100' },
  gray:   { bg: 'bg-gray-50',   border: 'border-gray-300',   text: 'text-gray-700',   activeBg: 'bg-gray-100' }
};

function buildDashboardCardsHTML(cards, activeKey, onClickFnName) {
  const colsCls = cards.length >= 5 ? 'md:grid-cols-5' : (cards.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3');
  return `<div class="grid grid-cols-2 ${colsCls} gap-2 mb-3">` +
    cards.map(c => {
      const colorName = (c.colorClass.match(/border-l-(\w+)-500/) || [])[1] || 'gray';
      const colors = DASHBOARD_CARD_COLOR_MAP[colorName] || DASHBOARD_CARD_COLOR_MAP.gray;
      const isActive = activeKey === c.key;
      return `
      <div class="cursor-pointer border rounded-lg p-2 text-center transition hover:shadow ${colors.border} ${isActive ? colors.activeBg + ' ring-2 ring-offset-1 ring-sky-400' : colors.bg}"
           data-op="${onClickFnName}" data-arg0="${c.key}">
        <div class="text-[11px] ${colors.text} font-semibold">${escapeHtml(c.label)}</div>
        <div class="text-lg font-bold ${colors.text}">${c.count}</div>
      </div>`;
    }).join('') +
    `</div>`;
}

// Bấm 1 thẻ dashboard: set giá trị cho 1 hoặc nhiều ô lọc, reset về trang 1, rồi vẽ lại danh sách.
// Dùng cho mọi module thay vì mỗi module tự viết 1 hàm filterXxxByCard() riêng.
// fields: { selectId: value, ... } — hầu hết thẻ chỉ set 1 ô (vd { filterStatusSub: 'PENDING' }),
// nhưng vài thẻ cần set đồng thời 2 chiều lọc (vd Tài Liệu: vừa trạng thái vừa loại tài liệu mới/cập
// nhật phiên bản).
function applyDashboardCardFilter(fields, resetKey, renderFn) {
  Object.entries(fields).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
  if (resetKey) resetListPage(resetKey);
  renderFn();
}

// Cắt đúng trang hiện tại từ mảng đã lọc + tự vẽ khối phân trang (đếm trang, các nút điều hướng)
// vào 2 phần tử #pageInfoText_<moduleKey> và #paginationButtons_<moduleKey>. Trả về mảng của riêng
// trang hiện tại để nơi gọi render ra bảng.
function paginateList(moduleKey, filteredItems, renderFnName, unitLabel) {
  const st = getListPageState(moduleKey);
  const totalItems = filteredItems.length;
  const totalPages = Math.ceil(totalItems / st.pageSize) || 1;
  if (st.page > totalPages) st.page = totalPages;
  if (st.page < 1) st.page = 1;

  const startIdx = (st.page - 1) * st.pageSize;
  const pageItems = filteredItems.slice(startIdx, startIdx + st.pageSize);

  const infoEl = document.getElementById(`pageInfoText_${moduleKey}`);
  if (infoEl) infoEl.innerText = `Trang ${st.page}/${totalPages} (Tổng ${totalItems} ${unitLabel || 'mục'})`;

  const btnsEl = document.getElementById(`paginationButtons_${moduleKey}`);
  if (btnsEl) {
    let html = `
      <button data-op="goToListPage" data-arg0="${moduleKey}" data-arg1="1" data-arg2="${renderFnName}" ${st.page === 1 ? 'disabled' : ''} class="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">«</button>
      <button data-op="goToListPage" data-arg0="${moduleKey}" data-arg1="${st.page - 1}" data-arg2="${renderFnName}" ${st.page === 1 ? 'disabled' : ''} class="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">‹</button>
    `;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= st.page - 1 && i <= st.page + 1)) {
        html += `<button data-op="goToListPage" data-arg0="${moduleKey}" data-arg1="${i}" data-arg2="${renderFnName}" class="px-2 py-1 border rounded ${i === st.page ? 'bg-blue-600 text-white font-bold' : 'bg-white hover:bg-gray-100'}">${i}</button>`;
      } else if (i === st.page - 2 || i === st.page + 2) {
        html += `<span class="px-1 text-gray-400">...</span>`;
      }
    }
    html += `
      <button data-op="goToListPage" data-arg0="${moduleKey}" data-arg1="${st.page + 1}" data-arg2="${renderFnName}" ${st.page === totalPages ? 'disabled' : ''} class="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">›</button>
      <button data-op="goToListPage" data-arg0="${moduleKey}" data-arg1="${totalPages}" data-arg2="${renderFnName}" ${st.page === totalPages ? 'disabled' : ''} class="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">»</button>
    `;
    btnsEl.innerHTML = html;
  }

  return pageItems;
}

// Khối HTML "thanh phân trang" dùng chung, chèn dưới mỗi bảng danh sách — id gắn theo moduleKey để
// không đụng nhau giữa các module trên cùng 1 trang.
function buildPaginationBoxHTML(moduleKey, renderFnName) {
  // BUG ĐÃ SỬA: trước đây "10" bị ĐÓNG CỨNG là option "selected" trong chuỗi HTML, trong khi khối này
  // được innerHTML lại (thay hẳn <select> cũ) ở MỌI lần render — kể cả lần render do CHÍNH việc đổi số
  // dòng/trang gây ra — nên chọn 20/50/5 xong là ô chọn tự nhảy lại về "10" dù bảng đã phân trang đúng
  // theo số vừa chọn. Phải đọc lại đúng pageSize hiện tại từ state để đánh dấu "selected" cho khớp.
  const currentPageSize = getListPageState(moduleKey).pageSize;
  const sizeOptionHTML = (size) => `<option value="${size}" ${currentPageSize === size ? 'selected' : ''}>${size}</option>`;
  return `
    <div id="paginationBox_${moduleKey}" class="mt-3 flex flex-col sm:flex-row justify-between items-center gap-3 bg-gray-50 p-3 rounded border text-xs text-gray-700">
      <div class="flex items-center gap-2">
        <span>Hiển thị</span>
        <select data-op-change="changeListPageSize" data-arg0="${moduleKey}" data-arg-value="1" data-arg2="${renderFnName}" class="border p-1 rounded bg-white font-semibold">
          ${[5, 10, 20, 50].map(sizeOptionHTML).join('')}
        </select>
        <span>dòng / trang.</span>
        <span id="pageInfoText_${moduleKey}" class="font-semibold text-gray-600 border-l pl-2 ml-1"></span>
      </div>
      <div id="paginationButtons_${moduleKey}" class="flex items-center gap-1"></div>
    </div>
  `;
}

// Khối "Thao Tác" dùng chung cho mọi bảng danh sách nghiệp vụ: giữ 1 nút chính (hành động cần chú ý
// nhất hoặc hay dùng nhất) hiển thị ngoài như trước, các thao tác còn lại gộp vào 1 dropdown "Khác ▾"
// bên cạnh — tránh mỗi dòng có quá nhiều nút bấm làm bảng thống kê rối mắt. Chọn 1 mục trong dropdown
// thực thi ngay qua hàm điều phối của module rồi tự trả dropdown về mục "Khác ▾" (không giữ lại lựa
// chọn cũ, vì đây là menu hành động chứ không phải bộ lọc).
// - primaryBtnHTML: chuỗi HTML <button> đã dựng sẵn cho hành động chính.
// - secondaryOptions: mảng [{ value, label }] — các hành động còn lại.
// - dispatcherFnName: tên hàm điều phối của module, nhận (id, value) và tự gọi đúng hàm xử lý.
//
// Wrapper CSP-safe cho onchange cũ "if(this.value){ dispatcherFn(id, this.value); } this.selectedIndex=0;"
// — 2 lệnh (gọi hàm điều phối rồi tự trả dropdown về "Khác ▾") nên không thể gọi thẳng qua data-op (chỉ
// nhận 1 lời gọi hàm đơn). selectEl nhận qua data-arg-el="0" (giống quy ước onVppHeadcountInput/
// updateMinutesDirectiveFieldMultiSelect ở trên — el luôn đúng vị trí tham số khớp thứ tự khai báo).
function handleActionCellDispatch(selectEl, dispatcherFnName, id) {
  if (selectEl.value) { window[dispatcherFnName](id, selectEl.value); }
  selectEl.selectedIndex = 0;
}
function buildActionCell(id, primaryBtnHTML, secondaryOptions, dispatcherFnName) {
  const opts = (secondaryOptions || []).filter(Boolean);
  if (opts.length === 0) return primaryBtnHTML;
  return `${primaryBtnHTML}<select data-op-change="handleActionCellDispatch" data-arg-el="0" data-arg1="${dispatcherFnName}" data-arg2="${id}" class="border rounded px-1 py-1 text-[11px] bg-white align-middle ml-1">
    <option value="">Khác ▾</option>
    ${opts.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
  </select>`;
}

// Ghi qua API append an toàn (POST /api/log, xem routes/systemLog.js) thay vì đọc/sửa/ghi đè cả mảng
// qua /api/data/systemLogs (syncStorage) — trước đây, khi 1 thao tác kích hoạt NHIỀU log liên tiếp
// gần như đồng thời (VD lập biên bản họp tự động tạo N Công việc, mỗi việc tự ghi 1 dòng log), các
// request đều dựa trên cùng 1 version cũ (If-Match) vì request đầu chưa kịp trả version mới cho các
// request sau dùng -> request thứ 2 trở đi bị server từ chối 409 "vừa bị người khác thay đổi", dù
// thực ra chỉ là chính client đó tự ghi log liên tiếp, không có ai ghi đè mất gì cả. Vẫn thêm ngay vào
// DB.systemLogs ở client để màn Nhật ký hệ thống cập nhật tức thì, không chờ phản hồi server (fire-
// and-forget, giống hành vi cũ) — nhưng không alert() khi request nền thất bại (khác thao tác nghiệp
// vụ chính, ghi log lỗi không nên làm gián đoạn người dùng).
function logSystemAction(module, actionType, description, status = 'SUCCESS', target = '') {
  const logEntry = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toLocaleString('vi-VN'),
    username: currentUser ? currentUser.username : 'system_guest',
    fullName: currentUser ? currentUser.name : 'Khách',
    // Chỉ là placeholder hiển thị TẠM ngay khi thao tác (chưa biết IP thật ở phía client) — IP thật
    // do SERVER tự xác định (req.ip, xem routes/systemLog.js) khi ghi dòng log thật bên dưới, và sẽ
    // thay thế đúng giá trị này ở lần tải lại Nhật ký hệ thống sau (loadSystemLogs()). KHÔNG phải giá
    // trị đã lưu — trước đây hard-code "127.0.0.1 (Localhost)" trông như 1 IP thật gây hiểu nhầm.
    ipAddress: '(đang xác nhận...)',
    module: module,
    actionType: actionType,
    targetObject: target,
    description: description,
    status: status
  };

  DB.systemLogs.unshift(logEntry);
  if (DB.systemLogs.length > 200) DB.systemLogs.pop();

  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module, actionType, description, status, target })
  }).catch(e => console.error('Lỗi khi ghi nhật ký hệ thống lên máy chủ:', e));
}

// ==========================================
// PHÂN QUYỀN THEO PHÂN HỆ MODULE (Submission/Contract/Meeting/Car/Office)
// ==========================================
// Mỗi module nghiệp vụ (Tờ trình, Hợp đồng, Phòng họp, Đăng ký xe, Văn phòng) có phạm vi dữ liệu
// riêng dạng { all: boolean, depts: string[] } cho hành động XEM và TẠO MỚI — giống hệt mô hình
// đã áp dụng cho module Tài liệu (uploadDepts/viewApprovedDepts...), thay vì 1 công tắc bật/tắt
// toàn công ty như trước (khiến ai cũng thấy dữ liệu của mọi phòng ban). Phòng ban của chính người
// dùng luôn được phép mặc định, kể cả khi admin chưa cấp thêm quyền nào khác.

// Kiểm tra 1 phạm vi {all, depts} có cho phép thao tác trên 1 phòng ban cụ thể hay không.
function scopeAllows(user, scope, dept) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (scope?.all) return true;
  if (dept && user.dept === dept) return true;
  return !!(dept && Array.isArray(scope?.depts) && scope.depts.includes(dept));
}

// Có ít nhất 1 phòng ban được phép hay không — dùng để bật/tắt quyền vào cả 1 tab/module.
function scopeHasAny(user, scope) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (scope?.all) return true;
  if (user.dept) return true; // luôn có ít nhất phòng ban của chính mình
  return !!(Array.isArray(scope?.depts) && scope.depts.length > 0);
}

// Danh sách các module nghiệp vụ có công tắc "Quyền Truy Cập Module" độc lập (không cần quyền
// admin) — admin bật/tắt riêng cho từng người dùng ở khối "0. Quyền Truy Cập Module". Đây CHỈ là công
// tắc VÀO ĐƯỢC MODULE hay không — quyền chi tiết làm được gì bên trong (vd officeBuy/paymentManage/
// vppManage/reportManage...) nằm hẳn ở các khối 1-16 trong cây phân quyền, không khai ở đây nữa (trước
// đây có cơ chế `subModules` lồng checkbox quyền ngay dưới mục 0, đã bỏ để tránh 2 nơi cấu hình cho
// cùng 1 quyền — xem lịch sử ở git log nếu cần đối chiếu).
// "car"/"meeting"/"vpp" mang field "parent" = con của "hanhchinh" (module Hành Chính) — hasModuleAccess()
// đọc field này để khoá CẢ 3 module con cùng lúc khi tắt quyền vào module cha, dù mỗi con vẫn giữ
// checkbox pModuleAccess_<key> riêng (đọc/ghi không đổi, xem readModuleAccessFromForm()/
// populateModuleAccessForm() — 2 hàm đó lặp phẳng qua TOÀN BỘ mảng này bất kể lồng cha/con hay không).
const BUSINESS_MODULES = [
  { key: 'doc', label: 'Tài Liệu' },
  { key: 'submission', label: 'Văn Bản Trình / Tờ Trình' },
  { key: 'task', label: 'Công Việc' },
  { key: 'internal', label: 'Truyền Thông Nội Bộ' },
  { key: 'contract', label: 'Hợp Đồng' },
  { key: 'minutes', label: 'Biên Bản Họp' },
  { key: 'hanhchinh', label: 'Hành Chính' },
  { key: 'meeting', label: 'Đặt Phòng Họp', parent: 'hanhchinh' },
  { key: 'car', label: 'Đăng Ký Xe', parent: 'hanhchinh' },
  // "Văn Phòng Phẩm" — quyền quản lý thật nằm ở pVppManage (khối 12 cây phân quyền), không khai ở đây.
  { key: 'vpp', label: 'Văn Phòng Phẩm', parent: 'hanhchinh' },
  // "Đồng Phục" — quyền thật nằm ở uniformManage/uniformStoreManage (khối 16 cây phân quyền, cùng
  // khuôn itPriceProposeCreate/itManage của Hỗ Trợ IT) — module này không mở sẵn cho ai, 2 quyền trên
  // vừa quyết định ĐƯỢC LÀM GÌ vừa quyết định VÀO ĐƯỢC MÀN NÀO (ai không có cả 2 quyền thì vào module
  // cũng không thấy nội dung nào).
  { key: 'uniform', label: 'Đồng Phục', parent: 'hanhchinh' },
  // "Giấy Phép" — quyền thật nằm ở licenseCreate/licenseApprove/licenseView (khối phân quyền riêng),
  // đúng khuôn "Đồng Phục" ở trên: module không mở sẵn cho ai, phân quyền hoàn toàn NGAY TRONG module
  // (không đi qua quy trình phòng ban), phòng ban khác không có 3 quyền này thì không thấy gì.
  { key: 'license', label: 'Giấy Phép', parent: 'hanhchinh' },
  // "Tổng Hợp" — quyền officeBuy/officeFix/paymentManage nằm ở khối 7/10 cây phân quyền.
  { key: 'office', label: 'Tổng Hợp' },
  // "Ngân Sách" — module con của "Tổng Hợp" (menu điều hướng gộp chung dropdown "Tổng Hợp", xem
  // #tongHopNavWrap), nhưng có màn hình/dữ liệu HOÀN TOÀN riêng (budgetPeriods/budgetTemplates/
  // budgetEntries, không chung gì với officeReqs) — quyền chi tiết budgetManage/budgetCreate/
  // budgetAggregate nằm ở khối 18 cây phân quyền.
  { key: 'budget', label: 'Ngân Sách', parent: 'office' },
  // "Hỗ Trợ IT" — mở cho TOÀN BỘ nhân viên (giống Công Việc/Tài Liệu, admin có thể tắt riêng qua
  // checkbox này nếu cần) — 2 sub-module con (Phê Duyệt Giá/Hỗ Trợ Yêu Cầu) không cần khoá riêng ở
  // đây vì quyền thật nằm ở itPriceProposeCreate/itManage (khối 13 cây phân quyền), chỉ chặn AI
  // ĐƯỢC TẠO/XỬ LÝ chứ không chặn ai được VÀO module.
  { key: 'itSupport', label: 'Hỗ Trợ IT' },
  // "Báo Cáo Định Kỳ" — quyền pReportManage/pReportAggregate/pReportEntryCreate nằm ở khối 13. Đây là
  // 1 QUY TRÌNH nghiệp vụ chủ động (nhân viên nộp báo cáo theo kỳ, có luồng tổng hợp/phê duyệt riêng)
  // — KHÁC "reports" bên dưới (màn tổng hợp SỐ LIỆU đọc từ 11 module khác, không có luồng nghiệp vụ
  // riêng của nó) — 2 module tuy tên gần giống nhau nhưng bản chất khác hẳn, không gộp/đổi chỗ.
  { key: 'periodicReport', label: 'Báo Cáo Định Kỳ' },
  // "Nhân Sự" — module TOP-LEVEL (không có parent), quyền thật là nhanSuManage (khối 21 cây phân
  // quyền), đúng khuôn "Đồng Phục"/"Giấy Phép": module không mở sẵn cho ai, không có quyền đó thì
  // không thấy/vào được. Từ khi tách "Cơ Cấu Tổ Chức" ra module con riêng (xem entry "orgChart" ngay
  // dưới đây) module này CHỈ còn ĐÚNG 1 tab con ("Quản Lý & Phản Hồi Ý Kiến") — KHÔNG khai vào
  // MODULE_TAB_MAP vì chính nhanSuManage vừa gác module vừa gác tab, không có khái niệm "quyền vào
  // tab" tách biệt.
  { key: 'hr', label: 'Nhân Sự' },
  // "Cơ Cấu Tổ Chức" — module con của "Nhân Sự" (menu điều hướng gộp chung dropdown "Nhân Sự", xem
  // #hrNavWrap), đúng khuôn "budget" là con của "office" ở trên — TÁCH RIÊNG khỏi module "hr" (trước
  // đây là 2 tab con CÙNG 1 module, xem git log "thêm tab con Cơ Cấu Tổ Chức") để dropdown "Nhân Sự"
  // có chỗ nối thêm các module con THẬT SỰ khác sau này (Onboarding/Offboarding/Hồ Sơ Nhân Sự/KPI/
  // Công & Phép...), mỗi module con là 1 entry parent:'hr' riêng như thế này. Dữ liệu HOÀN TOÀN riêng
  // (user.managerUsername, không chung gì với hrFeedback) — quyền thật orgChartManage HOẶC
  // nhanSuManage (khối 21, giữ nguyên 2 quyền cũ từng gác chung 1 tab trước đợt tách) — KHÔNG khai
  // vào MODULE_TAB_MAP vì module chỉ có đúng 1 tab, đúng khuôn "hr" ở trên.
  { key: 'orgChart', label: 'Cơ Cấu Tổ Chức', parent: 'hr' },
  // "Vận Hành" — module TOP-LEVEL mới, 3 luồng ĐỘC LẬP (không chung dữ liệu với officeReqs của "Tổng
  // Hợp"): quyền thật nằm ở operationOrderCreate/operationStoreOpenCreate/operationRepairCreate (khối
  // phân quyền riêng), đúng khuôn "Đồng Phục"/"Giấy Phép" — module không mở sẵn cho ai.
  { key: 'vanHanh', label: 'Vận Hành' },
  // "Báo Cáo" — CHUYỂN xuống cuối mảng (đúng vị trí thật trên sidebar, xem #btnReportsTab: nằm ngay
  // trước "Hệ Thống" — mục admin-only không khai ở BUSINESS_MODULES) vì đây là màn TỔNG HỢP/GIÁM SÁT
  // số liệu đọc từ 11 module khác (không có luồng nghiệp vụ chủ động riêng), gần với nhóm công cụ quản
  // trị/hệ thống hơn là nhóm module tác nghiệp hàng ngày phía trên.
  { key: 'reports', label: 'Báo Cáo' }
];

// "Bản đồ tab" cho mục "0. Quyền Truy Cập Module" — CHỈ liệt kê những module/module con có tab con mà
// việc HIỆN/ẨN tab đó do đúng 1 (hoặc vài, ghép OR) quyền phẳng cố định quyết định (đọc trong
// setXSubTab() ở public/index.html, vd setUniformSubTab()/setVppSubTab()/setOfficeSubTab()/
// setBudgetSubTab()/setPeriodicReportSubTab()) — KHÔNG liệt kê tab nào không có khái niệm "quyền vào
// tab" tách biệt (vd 2 tab gốc của Hỗ Trợ IT/Hợp Đồng vốn CHỦ ĐÍCH mở cho mọi người có quyền vào module,
// chỉ khác nhau ở BỘ LỌC hiển thị cùng 1 danh sách — ép thành checkbox riêng ở đây sẽ SAI với hành vi
// thật, xem chú thích canAccessContractModule()/"Hỗ Trợ Yêu Cầu... không cần quyền riêng" ở khối 15).
//
// KHÔNG tạo thêm quyền/nơi lưu nào mới — mỗi field bên dưới trỏ THẲNG tới đúng id checkbox đang nằm
// trong khối 1-18 (đã được đợt dọn cây quyền trước gom theo tên module, xem git log "Mục 3: move...").
// Mỗi module/module con dưới đây (khoá theo đúng key trong BUSINESS_MODULES) chỉ HIỂN THỊ (đọc), có nút
// "Đi tới" nhảy sang đúng khối thật để tick — xem renderModuleAccessCheckboxes()/jumpToPermField().
const MODULE_TAB_MAP = {
  vpp: [
    { label: 'Kỳ Đăng Ký + Báo Cáo Tổng Hợp', badgeKey: 'vpp', fields: [{ id: 'pVppManage', label: 'Quản lý' }] }
  ],
  // uniformApprove (Phase 2) mở được CẢ 2 tab (duyệt kỳ cấp phát lẫn điều chuyển kho) — any:true nghĩa là
  // hiện tab nếu có ÍT NHẤT 1 trong các quyền liệt kê (khớp canSeePeriods/canSeeStore ở setUniformSubTab()).
  uniform: [
    { label: 'Kỳ Cấp Phát', badgeKey: 'uniform', any: true, fields: [{ id: 'pUniformManage', label: 'Hành Chính' }, { id: 'pUniformApprove', label: 'Duyệt Kỳ Cấp Phát/Điều Chuyển Kho' }] },
    { label: 'Xác Nhận/Cấp Phát Kho', badgeKey: 'uniform', any: true, fields: [{ id: 'pUniformStoreManage', label: 'Giám Đốc Siêu Thị' }, { id: 'pUniformApprove', label: 'Duyệt Kỳ Cấp Phát/Điều Chuyển Kho' }] }
  ],
  // "Thanh Toán" là tab của "Tổng Hợp" (office) nhưng checkbox thật nằm ở khối 10 (badgeKey riêng
  // "payment") — khác 3 tab kia (checkbox nằm ngay trong khối "office" của chính module này).
  office: [
    { label: 'Mua Bán', badgeKey: 'office', fields: [{ id: 'pOfficeBuy', label: 'Mua Bán' }] },
    { label: 'Sửa Chữa', badgeKey: 'office', fields: [{ id: 'pOfficeFix', label: 'Sửa Chữa' }] },
    { label: 'Thanh Toán', badgeKey: 'payment', fields: [{ id: 'pPaymentManage', label: 'Quản lý Thanh Toán' }] }
  ],
  budget: [
    { label: 'Ngân Sách Phê Duyệt / Thực Hiện', badgeKey: 'budget', fields: [{ id: 'pBudgetCreate', label: 'Lập ngân sách' }] },
    { label: 'Quản Lý Kỳ &amp; Mẫu Ngân Sách', badgeKey: 'budget', fields: [{ id: 'pBudgetManage', label: 'Quản lý' }] },
    { label: 'Tổng Hợp Ngân Sách', badgeKey: 'budget', fields: [{ id: 'pBudgetAggregate', label: 'Tổng hợp' }] }
  ],
  vanHanh: [
    { label: 'Phê Duyệt Đơn Hàng', badgeKey: 'vanHanh', fields: [{ id: 'pOperationOrderCreate', label: 'Đơn Hàng' }] },
    { label: 'Mở Mới Siêu Thị', badgeKey: 'vanHanh', fields: [{ id: 'pOperationStoreOpenCreate', label: 'Mở Mới Siêu Thị' }] },
    { label: 'Sửa Chữa Siêu Thị', badgeKey: 'vanHanh', fields: [{ id: 'pOperationRepairCreate', label: 'Sửa Chữa Siêu Thị' }] }
  ],
  periodicReport: [
    { label: 'Tạo Kỳ Báo Cáo', badgeKey: 'periodicReport', fields: [{ id: 'pReportManage', label: 'Quản lý kỳ báo cáo' }] },
    { label: 'Tổng Hợp Báo Cáo', badgeKey: 'periodicReport', fields: [{ id: 'pReportAggregate', label: 'Tổng hợp báo cáo' }] }
  ],
  // itSupport CHỈ liệt kê tab "Gia Hạn Dịch Vụ" — 2 tab còn lại (🎫 Hỗ Trợ Yêu Cầu, 🏷️ Phê Duyệt Giá)
  // KHÔNG có ở đây: tab Yêu Cầu mở sẵn cho toàn bộ nhân viên (tự phục vụ, không quyền riêng — xem chú
  // thích khối 15), còn tab Phê Duyệt Giá hiện luôn cho mọi người vào được module (chỉ nút "Tạo yêu cầu"
  // bên trong đó mới cần itPriceProposeCreate — không phải quyền ẩn/hiện CẢ TAB). Xem setItSupportSubTab().
  itSupport: [
    { label: 'Gia Hạn Dịch Vụ', badgeKey: 'itSupport', fields: [{ id: 'pItManage', label: 'Đội Hỗ Trợ IT' }] }
  ],
  // "Báo Cáo" là module TỔNG HỢP số liệu của 11 module khác — không có quyền riêng nào cho từng tab
  // con cả, mỗi tab (Tài Liệu/Văn Bản Trình/Công Việc/Hợp Đồng/Biên Bản Họp/Phòng Họp/Xe/VPP/Văn Phòng
  // Tổng Hợp/Truyền Thông/Đồng Phục) CHỈ hiện nếu module tương ứng đang BẬT ở chính mục 0 này (xem
  // renderReportsNavPicker()) — không cần "Đi tới" đâu cả vì công tắc quyết định đã hiển thị NGAY TRÊN
  // cùng màn hình này rồi. Tab "Tổng Hợp" (tổng quan/tài chính/vận hành...) cũng tự ẩn từng phần theo
  // đúng module đang bật (xem renderReportsSummary()), không lộ số liệu của module đã tắt.
  reports: [
    { label: '16 màn báo cáo', note: 'tự ẩn/hiện theo đúng công tắc module tương ứng ở TRÊN (Tài Liệu, Văn Bản Trình, Công Việc, Hợp Đồng, Biên Bản Họp, Hỗ Trợ IT, Báo Cáo Định Kỳ, Truyền Thông, Phòng Họp, Xe, Văn Phòng Phẩm, Đồng Phục, Giấy Phép, Mua Bán/Sửa Chữa/Đầu Tư, Thanh Toán, Ngân Sách; cộng tab Tổng Hợp tự ẩn từng phần) — không có quyền riêng, không cần "Đi tới"' }
  ]
};

// Mở khối 1-18 chứa đúng quyền quyết định 1 tab (từ MODULE_TAB_MAP), cuộn tới + chớp sáng 1.8s để admin
// nhận ra ngay giữa cây quyền dài — KHÔNG tick/sửa gì cả, chỉ điều hướng (xem .perm-tree-jump-highlight).
function jumpToPermField(badgeKey) {
  const badge = document.getElementById('permTreeBadge_' + badgeKey);
  const detailsEl = badge ? badge.closest('details.perm-tree-node') : null;
  if (!detailsEl) return;
  detailsEl.open = true;
  detailsEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  detailsEl.classList.remove('perm-tree-jump-highlight');
  void detailsEl.offsetWidth; // ép reflow để restart animation nếu bấm "Đi tới" liên tiếp cùng 1 khối
  detailsEl.classList.add('perm-tree-jump-highlight');
}

// Các loại Văn bản trình / Tờ trình cố định (khớp đúng option value ở #subType) — dùng làm khoá để
// cấu hình quy trình phê duyệt RIÊNG cho từng loại (xem DB.submissionTypeDeptWorkflows,
// getSubmissionDeptWorkflowConfig()), vì các loại tờ trình khác nhau thường cần luồng duyệt khác nhau.
// "Loại Tờ Trình" — TRƯỚC ĐÂY gõ cứng ở đây (const SUBMISSION_TYPES), giờ admin tự thêm/bớt được tại
// màn Biểu Mẫu (nút Sửa trường mặc định "Loại Tờ Trình") nên chuyển thành dữ liệu DB.submissionTypes
// (seed đúng 5 giá trị cũ trong defaults.js, xem lib/createValidation.js SUBMISSION_TYPES_FALLBACK để
// biết vì sao vẫn còn 1 bản fallback y hệt ở server).

// 7 lớp phê duyệt BỔ SUNG tuỳ chọn cho Văn bản trình — cộng thêm vào SAU quy trình phòng ban (gốc,
// theo Loại Tờ Trình/phòng ban, KHÔNG đổi), theo đúng thứ tự cố định dưới đây: Đồng trình -> Phê duyệt
// đồng cấp -> Xin ý kiến (tham khảo trước, không chặn) -> Giám Đốc/Phó Giám Đốc -> Phó Tổng Giám Đốc ->
// Bộ Phận Trợ Lý/Thư Ký -> Tổng Giám Đốc (chỉ đạo cuối cùng). Người trình tick chọn lớp nào khi tạo tờ
// trình thì lớp đó được thêm vào cuối quy trình hiệu lực của đúng tờ trình đó (xem
// submitSubmissionReq()). Thành viên từng lớp do admin gán ở màn "Quản Lý Nhóm Phê Duyệt Trình"
// (DB.submissionApprovalGroups).
// blocking:true = trở thành 1 BƯỚC DUYỆT thật trong effectiveSteps (chặn quy trình, theo ĐÚNG thứ tự
// xuất hiện trong mảng này — xem buildEffectiveSubmissionWorkflow()). blocking:false (XIN_Y_KIEN) =
// kênh tham khảo song song, không chiếm 1 bước, không chặn, không có nút Duyệt/Từ chối — nhưng vị trí
// của nó trong mảng vẫn có ý nghĩa: các bước CHẶN nằm SAU nó sẽ hiện cảnh báo cho người duyệt nếu còn
// người được xin ý kiến chưa phản hồi (xem isSubmissionLayerAfterOpinion() + openProcessSubmissionModal()).
// buildEffectiveSubmissionWorkflow() bên dưới + lib/createValidation.js (LƯU Ý BẢO TRÌ, 2 bản độc lập,
// phải sửa đồng thời).
const SUBMISSION_APPROVAL_LAYERS = [
  { key: 'DONG_TRINH', label: 'Đồng trình', blocking: true },
  { key: 'DONG_CAP', label: 'Phê duyệt đồng cấp', blocking: true },
  { key: 'XIN_Y_KIEN', label: 'Xin ý kiến', blocking: false },
  { key: 'GD_PGD', label: 'Giám Đốc/Phó Giám Đốc', blocking: true },
  { key: 'PTGD', label: 'Phó Tổng Giám Đốc', blocking: true },
  { key: 'TRO_LY_THU_KY', label: 'Bộ Phận Trợ Lý/Thư Ký', blocking: true },
  { key: 'TGD', label: 'Tổng Giám Đốc', blocking: true }
];

// "Cấp Phê Duyệt Cuối Cùng" — người trình chọn 1 trong 4 mức này (gắn với chức danh người duyệt cuối
// cùng), quyết định trong số 7 lớp ở trên, lớp nào được PHÉP hiện ra để tick (visible), lớp nào trong
// số đó bị KHOÁ BẮT BUỘC luôn tick sẵn không được bỏ (locked, con của visible), lớp nào ẨN HẲN không
// hiện trong dropdown "Phê duyệt" (mọi lớp không thuộc visible). "Phê duyệt khác" (KHAC) = hành vi cũ,
// đủ cả 7 lớp và không khoá lớp nào — ĐẶT MẶC ĐỊNH cho <select> để không phá luồng thao tác quen thuộc
// hiện tại nếu người trình không chủ động chọn cấp cao hơn. Server (lib/createValidation.js) tự áp lại
// đúng luật này từ appData, không tin approvalLevel/selectedApprovalLayers client tự gửi lên (LƯU Ý BẢO
// TRÌ, 2 bản độc lập, phải sửa đồng thời).
const SUBMISSION_APPROVAL_LEVELS = [
  { key: 'TGD', label: 'Tổng giám đốc phê duyệt' },
  { key: 'PTGD', label: 'Phó tổng giám đốc phê duyệt' },
  { key: 'GD_PGD', label: 'Giám đốc/phó giám đốc phê duyệt' },
  { key: 'KHAC', label: 'Phê duyệt khác' }
];

const SUBMISSION_APPROVAL_LEVEL_RULES = {
  TGD: { visible: ['DONG_TRINH', 'DONG_CAP', 'XIN_Y_KIEN', 'GD_PGD', 'PTGD', 'TRO_LY_THU_KY', 'TGD'], locked: ['TRO_LY_THU_KY', 'TGD'] },
  PTGD: { visible: ['DONG_TRINH', 'DONG_CAP', 'XIN_Y_KIEN', 'GD_PGD', 'PTGD'], locked: ['PTGD'] },
  GD_PGD: { visible: ['DONG_TRINH', 'DONG_CAP', 'XIN_Y_KIEN', 'GD_PGD'], locked: ['GD_PGD'] },
  KHAC: { visible: SUBMISSION_APPROVAL_LAYERS.map(l => l.key), locked: [] }
};

function getSubmissionApprovalLevelRule(levelKey) {
  return SUBMISSION_APPROVAL_LEVEL_RULES[levelKey] || SUBMISSION_APPROVAL_LEVEL_RULES.KHAC;
}

// Quy trình Phê Duyệt HĐ (module Hợp đồng) — CHẠY ĐỘNG giống Văn Bản Trình (quy trình gốc theo phòng
// ban + lớp bổ sung tuỳ chọn theo "Cấp Phê Duyệt Cuối Cùng") nhưng TÁCH RIÊNG hoàn toàn: chỉ giữ 4 lớp
// cấp bậc (bỏ Đồng trình/Phê duyệt đồng cấp/Xin ý kiến), và dùng nhóm phê duyệt RIÊNG
// (DB.contractApprovalGroups, KHÔNG dùng chung DB.submissionApprovalGroups). Khớp đúng
// CONTRACT_APPROVAL_LAYERS/LEVELS/RULES ở lib/createValidation.js (LƯU Ý BẢO TRÌ — 2 cài đặt độc lập).
const CONTRACT_APPROVAL_LAYERS = [
  { key: 'GD_PGD', label: 'Giám Đốc/Phó Giám Đốc' },
  { key: 'PTGD', label: 'Phó Tổng Giám Đốc' },
  { key: 'TRO_LY_THU_KY', label: 'Bộ Phận Trợ Lý/Thư Ký' },
  { key: 'TGD', label: 'Tổng Giám Đốc' }
];
const CONTRACT_APPROVAL_LEVELS = [
  { key: 'TGD', label: 'Tổng giám đốc phê duyệt' },
  { key: 'PTGD', label: 'Phó tổng giám đốc phê duyệt' },
  { key: 'GD_PGD', label: 'Giám đốc/phó giám đốc phê duyệt' },
  { key: 'KHAC', label: 'Phê duyệt khác' }
];
const CONTRACT_APPROVAL_LEVEL_RULES = {
  TGD: { visible: ['GD_PGD', 'PTGD', 'TRO_LY_THU_KY', 'TGD'], locked: ['TRO_LY_THU_KY', 'TGD'] },
  PTGD: { visible: ['GD_PGD', 'PTGD'], locked: ['PTGD'] },
  GD_PGD: { visible: ['GD_PGD'], locked: ['GD_PGD'] },
  KHAC: { visible: CONTRACT_APPROVAL_LAYERS.map(l => l.key), locked: [] }
};
function getContractApprovalLevelRule(levelKey) {
  return CONTRACT_APPROVAL_LEVEL_RULES[levelKey] || CONTRACT_APPROVAL_LEVEL_RULES.KHAC;
}

// Di chuyển thành viên nhóm phê duyệt admin đã gán TRƯỚC KHI đổi tên lớp (khoá "BGD" -> "GD_PGD",
// "TGD_CT" -> "TGD") sang đúng khoá mới — CHỈ áp dụng trong bộ nhớ lúc tải dữ liệu, không tự ghi đè
// persisted storage (chỉ thực sự lưu lại khi admin bấm "Lưu Thành Viên" ở màn "Quản Lý Nhóm Phê Duyệt
// Trình", xem saveSubmissionApprovalGroup()) — để không mất thành viên đã gán trước khi có tính năng
// "Cấp Phê Duyệt Cuối Cùng". Khớp đúng hàm cùng tên trong lib/createValidation.js (LƯU Ý BẢO TRÌ).
function migrateSubmissionApprovalGroupKeys(groups) {
  const migrated = { ...(groups || {}) };
  const RENAME_MAP = { BGD: 'GD_PGD', TGD_CT: 'TGD' };
  Object.entries(RENAME_MAP).forEach(([oldKey, newKey]) => {
    if (Array.isArray(migrated[oldKey]) && migrated[oldKey].length) {
      migrated[newKey] = [...new Set([...(migrated[newKey] || []), ...migrated[oldKey]])];
    }
    delete migrated[oldKey];
  });
  return migrated;
}

// Vị trí lớp `layerKey` có nằm SAU lớp "Xin ý kiến" trong thứ tự chuẩn ở trên hay không — dùng để
// quyết định có cảnh báo "còn người chưa cho ý kiến" cho bước phê duyệt đó hay không. Lớp không có
// trong mảng (vd bước "Phòng ban" gốc, không đến từ 1 layer nào) luôn coi là KHÔNG nằm sau.
function isSubmissionLayerAfterOpinion(layerKey) {
  if (!layerKey) return false;
  const idx = SUBMISSION_APPROVAL_LAYERS.findIndex(l => l.key === layerKey);
  const opinionIdx = SUBMISSION_APPROVAL_LAYERS.findIndex(l => l.key === 'XIN_Y_KIEN');
  if (idx === -1 || opinionIdx === -1) return false;
  return idx > opinionIdx;
}

// Cổng truy cập module độc lập với các quyền hành động chi tiết (Xem/Tạo/Tải...) — admin luôn qua
// được; user thường mặc định được BẬT ở mọi module (giữ nguyên hành vi cũ) trừ khi admin tắt riêng.
function hasModuleAccess(user, moduleKey) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  const ma = user.perms?.moduleAccess;
  if (!ma) return true;
  // Module con (vd "car"/"meeting"/"vpp" thuộc cha "hanhchinh", xem BUSINESS_MODULES) bị khoá NGAY nếu
  // module cha tắt, bất kể checkbox riêng của module con đang bật hay tắt — cha khoá là khoá hết con.
  const mod = BUSINESS_MODULES.find(m => m.key === moduleKey);
  if (mod?.parent && ma[mod.parent] === false) return false;
  return ma[moduleKey] !== false;
}

// Danh sách phòng ban được phép — dùng đổ vào <select> phòng ban khi tạo mới 1 hồ sơ.
function getScopedDepts(user, scope) {
  if (!user) return [];
  if (user.perms?.admin || scope?.all) return [...DB.depts];
  const allowed = new Set();
  if (user.dept) allowed.add(user.dept);
  if (Array.isArray(scope?.depts)) scope.depts.forEach(d => allowed.add(d));
  return Array.from(allowed);
}

// Người dùng có được liệt kê làm người duyệt ở BẤT KỲ bước nào trong 1 cấu hình quy trình
// (dept workflow config) hay không — dùng để 1 approver luôn xem/duyệt được hồ sơ được giao,
// kể cả khi phạm vi Xem theo phòng ban của họ không bao gồm phòng ban đó.
function isApproverForDeptWorkflow(wfConfig, username) {
  if (!wfConfig || !wfConfig.approvers) return false;
  return Object.values(wfConfig.approvers).some(list =>
    Array.isArray(list) ? list.includes(username) : list === username
  );
}

// Quét toàn bộ map cấu hình quy trình theo phòng ban (vd DB.submissionDeptWorkflows) xem người
// dùng có phải approver ở phòng ban nào không — dùng để cấp quyền vào tab cho approver dù họ
// chưa được cấp quyền Xem tường minh cho phòng ban đó.
function isApproverInWorkflowMap(wfDeptMap, username) {
  if (!wfDeptMap) return false;
  return Object.values(wfDeptMap).some(cfg => isApproverForDeptWorkflow(cfg, username));
}

// ===== Hỗ Trợ IT > Phê Duyệt Giá — cấu hình duyệt theo phòng ban × LOẠI GIÁ (RETAIL/WHOLESALE) =====
// MIRROR ĐÚNG resolveItPriceDeptWorkflowConfig() ở lib/workflowEngine.js (server) — sửa 1 bên PHẢI sửa
// cả 2 bên (2 cài đặt độc lập, index.html chạy trong trình duyệt không import chung được với server).
// itPriceDeptWorkflows đổi cấu trúc từ { [dept]: {workflowId,approvers} } (CŨ, phẳng) sang lồng thêm 1
// cấp: { [dept]: { RETAIL: {...}, WHOLESALE: {...} } }. Tương thích ngược: cấu hình CŨ (phẳng, có
// workflowId trực tiếp, KHÔNG có nhánh RETAIL/WHOLESALE lồng bên trong) coi TOÀN BỘ là RETAIL —
// WHOLESALE coi như chưa cấu hình (null).
function resolveItPriceDeptWorkflowConfigClient(dept, priceType) {
  const cfg = (DB.itPriceDeptWorkflows || {})[dept];
  if (!cfg) return null;
  const type = priceType === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
  if (cfg.RETAIL || cfg.WHOLESALE) return cfg[type] || null;
  return type === 'RETAIL' ? cfg : null;
}

// Bán Buôn (WHOLESALE) — KHÔNG còn theo phòng ban, đổi sang theo 1 trong 4 mức Margin/Chiết Khấu cố
// định (mục B). MIRROR ĐÚNG resolveItPriceTierWorkflowConfig() ở lib/workflowEngine.js (server) —
// map PHẲNG, không cần tương thích ngược (cấu hình hoàn toàn mới).
function resolveItPriceTierWorkflowConfigClient(priceTier) {
  return (DB.itPriceTierWorkflows || {})[priceTier] || null;
}

// Quét TOÀN BỘ itPriceDeptWorkflows (mọi phòng ban × cả 2 loại giá) xem người dùng có phải approver ở
// đâu đó không — dùng cho canAccessApprovalHub() (không xét theo 1 hồ sơ cụ thể nên không có priceType
// để tra thẳng resolveItPriceDeptWorkflowConfigClient()).
function isApproverInItPriceWorkflowMap(wfDeptMap, username) {
  if (!wfDeptMap) return false;
  return Object.values(wfDeptMap).some(cfg => {
    if (!cfg) return false;
    if (cfg.RETAIL || cfg.WHOLESALE) {
      return isApproverForDeptWorkflow(cfg.RETAIL, username) || isApproverForDeptWorkflow(cfg.WHOLESALE, username);
    }
    return isApproverForDeptWorkflow(cfg, username);
  });
}

// Quét TOÀN BỘ itPriceTierWorkflows (4 mức Margin/Chiết Khấu) xem người dùng có phải approver ở mức
// nào không — cùng mục đích với isApproverInItPriceWorkflowMap() ở trên nhưng cho map PHẲNG mới (Bán
// Buôn), gọi CẢ 2 hàm ở nơi cần biết "user có phải approver ở ĐÂU ĐÓ trong module Hỗ Trợ IT không" (nếu
// không, người chỉ được gán làm approver cho 1 mức Margin/Chiết Khấu sẽ không thấy hồ sơ Bán Buôn trong
// "Phê Duyệt" tổng hợp dù họ thực sự là approver).
function isApproverInItPriceTierWorkflowMap(wfTierMap, username) {
  if (!wfTierMap) return false;
  return Object.values(wfTierMap).some(cfg => isApproverForDeptWorkflow(cfg, username));
}

// Điểm CHUNG duy nhất mà mọi nơi hiển thị/kiểm quyền của 1 hồ sơ itPriceApprovals CỤ THỂ nên gọi, thay
// vì tự branch resolveItPriceDeptWorkflowConfigClient()/resolveItPriceTierWorkflowConfigClient() rải
// rác — MIRROR ĐÚNG nhánh trong resolveWfConfig() (lib/workflowEngine.js, mục B): WHOLESALE tra theo
// item.priceTier (4 mức cố định), RETAIL tra theo item.dept như cũ 100%. Gộp về 1 hàm để không bỏ sót
// chỗ nào khi thêm mới (bug mục B dễ bỏ sót nhất trong cả đợt vì rải rác nhiều nơi).
function resolveItPriceWorkflowConfigForItemClient(p) {
  if ((p.priceType || 'RETAIL') === 'WHOLESALE') return resolveItPriceTierWorkflowConfigClient(p.priceTier);
  return resolveItPriceDeptWorkflowConfigClient(p.dept, 'RETAIL');
}

// Nhãn hiển thị cho 4 mức Margin/Chiết Khấu cố định — khớp options của #itPriceTier + fixedTiers ở
// WF_MODULE_CONFIG.ITPRICE (public/index.html) — chỉ dùng để hiển thị, KHÔNG dùng để xác thực (validate
// thật nằm ở lib/createValidation.js phía server).
const IT_PRICE_TIER_LABELS = {
  MARGIN_LT5: 'Margin < 5%', MARGIN_GTE5: 'Margin ≥ 5%',
  DISCOUNT_LTE5: 'Chiết khấu ≤ 5%', DISCOUNT_GT5: 'Chiết khấu > 5%'
};
function itPriceTierLabel(tier) {
  return IT_PRICE_TIER_LABELS[tier] || tier || '—';
}

// ==========================================
// ĐỒNG PHÊ DUYỆT (nhiều người duyệt cùng 1 bước) — dùng chung cho mọi module có luồng duyệt nhiều
// bước (Tài liệu, Văn bản trình, Đăng ký xe, Văn phòng). Khi 1 bước được gán từ 2 người duyệt trở
// lên, bước chỉ thực sự hoàn tất (chuyển bước tiếp/kết thúc quy trình) khi TẤT CẢ đều đã bấm Duyệt
// — trước đây chỉ cần 1 trong số họ duyệt là chuyển bước ngay, bỏ qua ý kiến những người còn lại.
// ==========================================

// Chuẩn hoá danh sách approver của 1 bước về dạng mảng (dữ liệu cũ có thể là 1 string đơn lẻ).
function normalizeApproversList(stepApprovers) {
  if (Array.isArray(stepApprovers)) return stepApprovers;
  if (stepApprovers) return [stepApprovers];
  return [];
}

// Tập username đã bấm Duyệt ở ĐÚNG bước hiện tại, dựa theo lịch sử xử lý (history) của hồ sơ. Khớp
// đúng getStepApprovedUsernames() ở lib/workflowEngine.js — REQUEST_CHANGES đánh dấu invalidated=true
// lên mọi lượt APPROVED cũ khi hồ sơ quay lại NHÁP sửa/gửi lại (nội dung đã đổi, lượt duyệt cũ không
// còn giá trị cho vòng MỚI). Thiếu "&& !h.invalidated" ở đây khiến giao diện tính SAI: coi 1 người đã
// duyệt bước này (từ vòng nộp TRƯỚC, đã bị vô hiệu) là "đã xử lý xong", ẩn nhầm nút Duyệt của họ ở vòng
// nộp lại — trong khi server (đã lọc đúng invalidated) vẫn chờ đúng người đó duyệt lại lần nữa.
function getStepApprovedUsernames(history, step) {
  return new Set((history || []).filter(h => h.step === step && h.action === 'APPROVED' && !h.invalidated).map(h => h.username));
}

// Người dùng có được phép bấm Duyệt ở bước này không: là admin, hoặc có tên trong danh sách đồng
// duyệt của bước VÀ CHƯA tự mình duyệt bước này rồi (chặn duyệt trùng 2 lần cùng 1 người).
function canApproveStep(user, stepApprovers, history, step) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  const approversList = normalizeApproversList(stepApprovers);
  if (!approversList.includes(user.username)) return false;
  return !getStepApprovedUsernames(history, step).has(user.username);
}

// Bước đã đủ TẤT CẢ người đồng duyệt bấm Duyệt hay chưa — quyết định có được chuyển sang bước tiếp
// theo (hoặc hoàn tất quy trình) hay còn phải chờ. Admin bấm Duyệt luôn coi là đủ điều kiện, ghi đè
// yêu cầu đồng thuận — nhất quán với việc admin luôn có toàn quyền vượt qua mọi cấu hình approver
// ở những chỗ khác trong hệ thống.
function isStepApprovalComplete(user, stepApprovers, history, step) {
  if (user?.perms?.admin) return true;
  const approversList = normalizeApproversList(stepApprovers);
  if (approversList.length === 0) return true;
  const approved = getStepApprovedUsernames(history, step);
  return approversList.every(u => approved.has(u));
}

// Chuỗi hiển thị tiến độ đồng duyệt (VD: " (Đã 1/2 người duyệt)") — chỉ có nội dung khi bước được
// gán từ 2 người đồng duyệt trở lên, để không đổi hiển thị của các bước 1-người-duyệt như cũ.
function getStepApprovalProgressText(stepApprovers, history, step) {
  const approversList = normalizeApproversList(stepApprovers);
  if (approversList.length <= 1) return '';
  const approved = getStepApprovedUsernames(history, step);
  return ` (Đã ${approved.size}/${approversList.length} người duyệt)`;
}

// Thông báo khi 1 bước đã hoàn tất (đủ điều kiện chuyển bước/kết thúc quy trình) — dùng đúng chữ
// "đồng phê duyệt" chỉ khi bước đó thực sự có từ 2 người duyệt trở lên, tránh gây hiểu nhầm ở
// trường hợp phổ biến nhất (1 người duyệt/bước) vốn luôn chuyển bước ngay như hành vi cũ.
function getStepAdvanceMessage(stepApprovers) {
  return normalizeApproversList(stepApprovers).length > 1
    ? '✅ Đã đủ đồng phê duyệt bước này — chuyển sang bước tiếp theo!'
    : '✅ Đã chuyển sang bước phê duyệt tiếp theo!';
}

// ==========================================
// VĂN BẢN TRÌNH — QUY TRÌNH THEO LOẠI TỜ TRÌNH + LỚP PHÊ DUYỆT BỔ SUNG CỘNG THÊM
// ==========================================

// Cấu hình quy trình phòng ban CHO ĐÚNG LOẠI tờ trình — ưu tiên cấu hình riêng của loại đó nếu admin
// đã thiết lập, không có thì rơi về cấu hình chung theo phòng ban (DB.submissionDeptWorkflows, hành
// vi cũ trước khi có tính năng theo loại) — nên chưa cấu hình gì thêm thì hành vi giữ nguyên như cũ.
function getSubmissionDeptWorkflowConfig(type, dept) {
  const typeEntry = DB.submissionTypes.find(t => t.label === type);
  const typeKey = typeEntry ? typeEntry.key : 'KHAC';
  const typeMap = DB.submissionTypeDeptWorkflows[typeKey];
  const fromType = typeMap ? typeMap[dept] : null;
  if (fromType) return fromType;
  return DB.submissionDeptWorkflows[dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
}

// Lấy quy trình HIỆU LỰC của 1 tờ trình ĐÃ TẠO — dùng snapshot đã chốt lúc tạo (effectiveSteps/
// effectiveApprovers) nếu có; tờ trình cũ tạo trước khi có tính năng này thì suy ra như cách cũ
// (quy trình phòng ban theo loại, không có lớp bổ sung nào) để không phá vỡ dữ liệu đã có.
function resolveSubmissionWorkflow(sub) {
  if (sub.effectiveSteps && sub.effectiveApprovers) {
    return { steps: sub.effectiveSteps, approvers: sub.effectiveApprovers };
  }
  const baseConfig = getSubmissionDeptWorkflowConfig(sub.type, sub.dept);
  const baseWf = DB.workflows.find(w => w.id === baseConfig.workflowId) || { steps: [{ order: 1, name: 'Sếp duyệt' }] };
  const steps = baseWf.steps.map(s => ({ order: s.order, name: s.name }));
  const approvers = {};
  baseWf.steps.forEach(s => { approvers[s.order] = baseConfig.approvers?.[s.order] || []; });
  return { steps, approvers };
}

// Hợp đồng — 2 quy trình TÁCH RIÊNG trên CÙNG 1 bản ghi (khớp lib/workflowEngine.js): "Phê Duyệt"
// (approvalStatus/currentStep/history, snapshot effectiveSteps/effectiveApprovers lúc tạo — cùng khuôn
// resolveSubmissionWorkflow() ở trên) và "Quản Lý HĐ"/Tài liệu ký (signedFileStatus/
// signedFileCurrentStep/signedFileHistory, KHÔNG snapshot — luôn tra DB.contractManageDeptWorkflows
// mới nhất, cùng khuôn Xe/Mua Bán/VPP).
function resolveContractApprovalWorkflow(contract) {
  if (contract.effectiveSteps && contract.effectiveApprovers) {
    return { steps: contract.effectiveSteps, approvers: contract.effectiveApprovers };
  }
  const baseConfig = DB.contractApprovalDeptWorkflows?.[contract.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const baseWf = DB.workflows.find(w => w.id === baseConfig.workflowId) || { steps: [{ order: 1, name: 'Sếp duyệt' }] };
  const steps = baseWf.steps.map(s => ({ order: s.order, name: s.name }));
  const approvers = {};
  baseWf.steps.forEach(s => { approvers[s.order] = baseConfig.approvers?.[s.order] || []; });
  return { steps, approvers };
}

function resolveContractManageWorkflow(contract) {
  const wfConfig = DB.contractManageDeptWorkflows?.[contract.dept];
  const baseWf = DB.workflows.find(w => w.id === wfConfig?.workflowId) || { steps: [{ order: 1, name: 'Duyệt' }] };
  return { steps: baseWf.steps, approvers: wfConfig?.approvers || {} };
}

// Dựng quy trình HIỆU LỰC cho 1 hợp đồng/phụ lục MỚI (lúc tạo) — cùng khuôn buildEffectiveSubmissionWorkflow()
// nhưng dùng CONTRACT_APPROVAL_LAYERS/DB.contractApprovalGroups/DB.contractApprovalDeptWorkflows riêng,
// và KHÔNG có nhánh không-chặn (cả 4 lớp đều blocking, không có opinionRequestees).
function buildEffectiveContractApprovalWorkflow(dept, selectedLayerKeys, selectedLayerMembers) {
  const baseConfig = DB.contractApprovalDeptWorkflows?.[dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const baseWf = DB.workflows.find(w => w.id === baseConfig.workflowId) || { steps: [{ order: 1, name: 'Sếp duyệt' }] };

  const steps = baseWf.steps.map(s => ({ order: s.order, name: s.name }));
  const approvers = {};
  baseWf.steps.forEach(s => { approvers[s.order] = baseConfig.approvers?.[s.order] || []; });

  (selectedLayerKeys || []).forEach(layerKey => {
    const layer = CONTRACT_APPROVAL_LAYERS.find(l => l.key === layerKey);
    if (!layer) return;
    const chosen = [...(selectedLayerMembers?.[layerKey] || [])];
    const stepOrder = steps.length + 1;
    steps.push({ order: stepOrder, name: layer.label, layerKey: layer.key });
    approvers[stepOrder] = chosen;
  });

  return { steps, approvers };
}

// Xem trước quy trình Phê Duyệt HĐ — cùng khuôn buildSubmissionWorkflowPreviewHTML(), không có khối
// "Xin ý kiến" (không tồn tại trong quy trình này).
function buildContractApprovalWorkflowPreviewHTML(dept, selectedLayerKeys, selectedLayerMembers) {
  if (!dept) {
    return '<div class="text-amber-600 italic">Vui lòng chọn Phòng Ban Quản Lý để xem quy trình.</div>';
  }
  const userLabel = (username) => {
    const u = DB.users.find(x => x.username === username);
    return escapeHtml(u ? u.name : username);
  };
  const wf = buildEffectiveContractApprovalWorkflow(dept, selectedLayerKeys, selectedLayerMembers);
  const stepsHTML = wf.steps.map(s => {
    const names = (wf.approvers[s.order] || []).map(userLabel).join(', ') ||
      '<span class="text-amber-600 italic">(chưa có người duyệt — kiểm tra lại cấu hình quy trình phòng ban)</span>';
    return `
      <div class="bg-slate-50 border rounded p-2 mb-1.5">
        <div class="font-bold text-gray-800">Bước ${s.order}: ${escapeHtml(s.name)}</div>
        <div class="text-gray-600 mt-0.5">Người duyệt: ${names}</div>
      </div>`;
  }).join('');
  return `<div>${stepsHTML}</div>`;
}

// Đọc lại đúng lớp phê duyệt bổ sung + người đã chọn TỪ FORM HỢP ĐỒNG HIỆN TẠI — cùng khuôn
// readSelectedSubmissionLayers() nhưng đọc từ panel/checkbox class riêng của form Hợp đồng.
function readSelectedContractLayers() {
  const selectedLayerKeys = [...document.querySelectorAll('#contractApprovalDropdownPanel input.contract-layer-toggle:checked')].map(cb => cb.value);
  const selectedLayerMembers = {};
  for (const layerKey of selectedLayerKeys) {
    selectedLayerMembers[layerKey] = [...document.querySelectorAll(`input.contract-layer-member[data-layer="${layerKey}"]:checked`)].map(cb => cb.value);
  }
  return { selectedLayerKeys, selectedLayerMembers };
}

// --- HÀM KIỂM TRA PHÂN QUYỀN THEO MODULE ---
function canAccessDocModule(user) {
  if (!user) return false;
  return hasModuleAccess(user, 'doc');
}

function canAccessTaskModule(user) {
  if (!user) return false;
  return hasModuleAccess(user, 'task');
}

// Hỗ Trợ IT — mở cho toàn bộ nhân viên (giống Công Việc, admin có thể tắt riêng qua checkbox
// moduleAccess.itSupport nếu cần); quyền thật (đề xuất duyệt giá/quản lý xử lý) nằm ở
// itPriceProposeCreate/itManage, không phải điều kiện vào module.
function canAccessItSupportModule(user) {
  if (!user) return false;
  return hasModuleAccess(user, 'itSupport');
}
function canProposeItPrice(user) {
  return !!(user?.perms?.admin || user?.perms?.itPriceProposeCreate);
}
function canManageItSupportClient(user) {
  return !!(user?.perms?.admin || user?.perms?.itManage);
}
function canApproveItPriceEmergencyRejectClient(user) {
  return !!(user?.perms?.admin || user?.perms?.itPriceEmergencyRejectApprove);
}
// Đúng người đã bấm Duyệt ở bước cuối cùng (item.currentStep khi status đã APPROVED, engine không tăng
// currentStep nữa sau bước cuối) — chỉ họ (hoặc admin) mới thấy nút "🚨 Từ chối khẩn", khớp lib/recordActions.js::isFinalStepApproverOfItPrice().
function isFinalStepApproverOfItPriceClient(user, p) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  return (p.history || []).some(h => h.step === p.currentStep && h.action === 'APPROVED' && !h.invalidated && h.username === user.username);
}

// "Quản trị" Công việc: gộp quyền Tạo mới + Sửa (đổi tiêu đề/nội dung/hạn/người nhận) — người có
// quyền này xử lý được TOÀN BỘ công việc, không chỉ việc của mình.
function canManageTasks(user) {
  if (!user) return false;
  return !!(user.perms?.admin || user.perms?.taskEdit);
}

// XEM 1 công việc cụ thể: admin/người có quyền taskView (xem toàn bộ), người được giao, hoặc người
// đã giao việc đó (giữ đúng hành vi tiện lợi hiện có — người giao vẫn theo dõi được việc mình giao).
// Trưởng phòng (đệ quy theo Cơ Cấu Tổ Chức, xem isManagerOf() ở block Cơ Cấu Tổ Chức) XEM được task của
// nhân viên mình quản lý — CHỈ xem, không thao tác thay (canManageTasks/canAssignSpecificTask/
// canDeleteTaskRecord không đụng gì, vẫn khoá theo taskEdit/assignedBy như cũ). Mirror ĐÚNG server
// lib/recordViewScope.js canViewTaskRecord().
function canViewTaskRecord(user, t) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (user.perms?.taskView) return true;
  if (t.assignedTo === user.username || t.assignedBy === user.username || (t.collaborators || []).includes(user.username)) return true;
  return isManagerOf(user.username, t.assignedTo, DB.users);
}

function canDeleteTaskRecord(user) {
  if (!user) return false;
  return !!(user.perms?.admin || user.perms?.taskDelete);
}

function canDownloadTaskRecord(user) {
  if (!user) return false;
  return !!(user.perms?.admin || user.perms?.taskDownload);
}

function canAccessInternalModule(user) {
  if (!user) return false;
  return hasModuleAccess(user, 'internal');
}

function canAccessSubmissionModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (!hasModuleAccess(user, 'submission')) return false;
  return scopeHasAny(user, user.perms?.submissionView) || isApproverInWorkflowMap(DB.submissionDeptWorkflows, user.username);
}

function canAccessContractModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (!hasModuleAccess(user, 'contract')) return false;
  return scopeHasAny(user, user.perms?.contractView);
}

// Người dùng có được duyệt hợp đồng này ở ĐÚNG bước hiện tại của quy trình Phê Duyệt HĐ hay không —
// dùng canApproveStep() chung (xem "ĐỒNG PHÊ DUYỆT" ở trên) + resolveContractApprovalWorkflow(), thay
// cho cờ quyền phẳng contractApprove trước đây (quy trình giờ theo bước/phòng ban, server tự xác thực
// lại ở lib/workflowEngine.js, đây chỉ để quyết định hiện/ẩn nút Duyệt/Từ chối).
function canApproveContractStep(user, contract) {
  const wfConfig = resolveContractApprovalWorkflow(contract);
  const stepApprovers = wfConfig.approvers?.[contract.currentStep] || [];
  return canApproveStep(user, stepApprovers, contract.history, contract.currentStep);
}

// Upload "Tài liệu ký" + bấm nút "Thanh toán" — theo phạm vi quyền contractCreate của ĐƠN VỊ CUSTODIAN
// (custodianDept, mặc định = dept khi hồ sơ không chọn riêng), khớp đúng canManageContractPayment() ở
// lib/recordActions.js.
function canManageContractPaymentClient(user, contract) {
  return !!(user?.perms?.admin || scopeAllows(user, user?.perms?.contractCreate, contract.custodianDept || contract.dept));
}

// Khớp đúng canManageOfficePayment() ở lib/recordActions.js.
const OFFICE_SUBTYPE_TO_PERM_FLAG_CLIENT = { MUA_BAN: 'officeBuy', SUA_CHUA: 'officeFix' };
function canManageOfficePaymentClient(user, item) {
  const flag = OFFICE_SUBTYPE_TO_PERM_FLAG_CLIENT[item.subType];
  return !!(user?.perms?.admin || (scopeAllows(user, user?.perms?.officeCreate, item.dept) && (!flag || user?.perms?.[flag])));
}

function canBookMeeting(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  return scopeHasAny(user, user.perms?.meetingBookScope);
}

function canApproveMeeting(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  return !!user.perms?.meetingApprove;
}

// Mọi user LUÔN huỷ được lịch do CHÍNH MÌNH đặt (creator === self, không cần quyền gì thêm) —
// meetingCancel ("Người quản lý phòng họp") + admin huỷ được lịch của BẤT KỲ ai. Tham số "meeting" tuỳ
// chọn (bỏ trống khi chỉ cần biết user có phải "quản lý phòng họp" hay không, vd hiện nhãn quyền).
function canCancelMeeting(user, meeting) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.meetingCancel) return true;
  return !!(meeting && meeting.creator === user.username);
}

function canAccessMeetingModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (!hasModuleAccess(user, 'meeting')) return false;
  return scopeHasAny(user, user.perms?.meetingView) || canBookMeeting(user) || canApproveMeeting(user) || canCancelMeeting(user);
}

function canAccessCarModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (!hasModuleAccess(user, 'car')) return false;
  // Lái xe được phân công (assignedDriverUsername) — dù không có carView/không nằm trong bất kỳ
  // carDeptWorkflows[dept].approvers nào — vẫn cần vào được để xem/tự xác nhận chuyến của MÌNH ở
  // sub-tab "Lái Xe" (renderCarDriverTab(), khớp canViewCarReg() ở lib/recordViewScope.js: GET
  // /api/data đã tự lọc DB.carRegs xuống đúng các phiếu họ được phân công làm lái xe, kể cả khi
  // module bị ẩn khỏi sidebar trước đây). Chỉ mở đúng lối vào sidebar + sub-tab đó — không mở thêm
  // quyền gì khác trong module (họ vẫn không thấy/không duyệt được phiếu của phòng ban khác).
  const isAssignedDriverSomewhere = (DB.carRegs || []).some(c => c.assignedDriverUsername === user.username);
  return scopeHasAny(user, user.perms?.carView) || isApproverInWorkflowMap(DB.carDeptWorkflows, user.username) || isAssignedDriverSomewhere;
}

// Văn phòng phẩm: KHÔNG có khái niệm quyền "Xem/Tạo" riêng theo phòng ban (khác Xe/Phòng họp) — mọi
// người đã đăng nhập (còn quyền vào module ở mục 0) đều tự đăng ký được ở kỳ đang mở, người duyệt theo
// vppDeptWorkflows cũng vào được để xử lý, người có vppManage/admin quản lý toàn bộ. Vào module được là
// đủ, không cần thêm điều kiện phụ như Xe/Phòng họp.
function canAccessVppModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  return hasModuleAccess(user, 'vpp');
}

// Đồng Phục — KHÔNG mở sẵn cho mọi người như VPP (chỉ Hành Chính/uniformManage tạo kỳ, Giám Đốc Siêu
// Thị/uniformStoreManage xác nhận+cấp phát, uniformApprove (Phase 2) duyệt kỳ/điều chuyển kho — không
// có luồng nào cho nhân viên thường vào module này).
function canAccessUniformModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (!hasModuleAccess(user, 'uniform')) return false;
  return !!(user.perms?.uniformManage || user.perms?.uniformStoreManage || user.perms?.uniformApprove);
}

// Giấy Phép — cùng khuôn Đồng Phục: KHÔNG mở sẵn cho ai, chỉ người có 1 trong 3 quyền phẳng riêng của
// module (licenseCreate/licenseApprove/licenseView, xem lib/recordActions.js + lib/recordViewScope.js)
// mới vào được — phòng ban khác không có quyền nào trong 3 quyền này thì không thấy module.
function canAccessLicenseModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (!hasModuleAccess(user, 'license')) return false;
  return !!(user.perms?.licenseCreate || user.perms?.licenseApprove || user.perms?.licenseView);
}

// Vào được module "Báo Cáo Định Kỳ" (kỳ báo cáo tuần → nhập liệu → tổng hợp → phát hành) hay không —
// cổng chung, không phải "được làm gì trong đó" (tạo kỳ = reportManage, tổng hợp/phát hành =
// reportAggregate, nộp báo cáo = reportEntryCreate — xét riêng ở từng màn con, xem
// canCreateReportEntryClient(). Còn quyền vào module rồi thì ai cũng XEM được danh sách báo cáo trong
// phạm vi phòng ban mình dù không có reportEntryCreate — xem renderPrEntryTable()).
function canAccessPeriodicReportModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  return hasModuleAccess(user, 'periodicReport');
}

// Vào được module Biên bản họp hay không (cổng chung, chưa xét từng biên bản cụ thể). XEM/Sửa/Xóa/
// Tải từng biên bản cụ thể xét riêng ở canView/Edit/Delete/DownloadMeetingMinutesRecord() bên dưới.
function canAccessMeetingMinutesModule(user) {
  if (!user) return false;
  return hasModuleAccess(user, 'minutes');
}

function canCreateMeetingMinutes(user) {
  if (!user) return false;
  return !!(user.perms?.admin || user.perms?.minutesCreate);
}

// Cổng vào module "✅ Phê Duyệt" (hộp thư duyệt tổng hợp, gom mọi hồ sơ PENDING mà đúng người này
// đang được duyệt từ 9 module có luồng duyệt — Tài liệu/Văn bản trình/Đăng ký xe/Mua Bán/Sửa Chữa/
// Đầu Tư/VPP/Hợp đồng/Phòng họp/Góc chia sẻ/Thanh toán). KHÔNG phải 1 quyền admin cấp riêng — hiện ra
// cho BẤT KỲ ai đang thực sự nằm trong ít nhất 1 luồng duyệt (đang được gán làm approver ở 1 bước quy
// trình phòng ban nào đó, hoặc có 1 trong các quyền duyệt phẳng không theo bước) để không phải đợi
// admin cấp thêm quyền mới thấy được hộp thư của chính mình.
function canAccessApprovalHub(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (user.perms?.contractApprove || user.perms?.meetingApprove || user.perms?.internalPostApprove || user.perms?.paymentManage || user.perms?.licenseApprove) return true;
  if (isApproverInWorkflowMap(DB.deptWorkflows, user.username)) return true;
  if (isApproverInWorkflowMap(DB.submissionDeptWorkflows, user.username)) return true;
  if (Object.values(DB.submissionTypeDeptWorkflows || {}).some(typeMap => isApproverInWorkflowMap(typeMap, user.username))) return true;
  if (Object.values(DB.submissionApprovalGroups || {}).some(list => Array.isArray(list) && list.includes(user.username))) return true;
  if (isApproverInWorkflowMap(DB.carDeptWorkflows, user.username)) return true;
  if (isApproverInWorkflowMap(DB.officeBuyDeptWorkflows, user.username)) return true;
  if (isApproverInWorkflowMap(DB.officeFixDeptWorkflows, user.username)) return true;
  if (isApproverInWorkflowMap(DB.vppDeptWorkflows, user.username)) return true;
  if (isApproverInWorkflowMap(DB.contractApprovalDeptWorkflows, user.username)) return true;
  if (isApproverInWorkflowMap(DB.contractManageDeptWorkflows, user.username)) return true;
  if (Object.values(DB.contractApprovalGroups || {}).some(list => Array.isArray(list) && list.includes(user.username))) return true;
  if (isApproverInItPriceWorkflowMap(DB.itPriceDeptWorkflows, user.username)) return true;
  if (isApproverInItPriceTierWorkflowMap(DB.itPriceTierWorkflows, user.username)) return true;
  return false;
}

// Có mặt trong Thành phần tham dự của 1 biên bản cụ thể hay không. Dòng tham dự viên ĐÃ CHỈ ĐÍCH DANH
// tài khoản (hasAccount === 'YES' + username) khớp CHÍNH XÁC theo username; chỉ dòng khách mời/người
// ngoài (không có tài khoản) mới khớp theo Họ và Tên như trước. Trước đây khớp theo tên cho MỌI dòng,
// nên 2 nhân viên trùng tên hiển thị cùng xem được biên bản chỉ mời 1 người — giữ ĐỒNG BỘ với
// isMeetingMinutesAttendeeServer() ở lib/recordViewScope.js (bộ lọc thật của GET /api/data).
function isMeetingMinutesAttendee(user, m) {
  if (!user) return false;
  const uname = (user.name || '').trim().toLowerCase();
  const uUsername = (user.username || '').trim();
  return (m.attendees || []).some(a => {
    const aUsername = (a.username || '').trim();
    if (a.hasAccount === 'YES' && aUsername) return !!uUsername && aUsername === uUsername;
    return !!uname && (a.name || '').trim().toLowerCase() === uname;
  });
}

// XEM: admin, người có quyền minutesView (xem toàn bộ), người tạo, hoặc người có tên trong thành
// phần tham dự của chính biên bản đó (chỉ xem, không tự tải/sửa/xóa được nếu không có quyền khác).
function canViewMeetingMinutesRecord(user, m) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (user.perms?.minutesView) return true;
  if (m.creator === user.username) return true;
  return isMeetingMinutesAttendee(user, m);
}

// Biên bản đã "Giao việc" (m.tasksAssigned, xem assignMinutesTasks()) bị khoá sửa với TẤT CẢ mọi
// người, kể cả người tạo/minutesEdit — chỉ admin còn sửa được, coi như trường hợp khẩn cấp (server
// xác minh lại đúng luật này ở editMinutes(), đây chỉ là ẩn/hiện nút cho khớp UI).
function canEditMeetingMinutesRecord(user, m) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (m.tasksAssigned) return false;
  if (user.perms?.minutesEdit) return true;
  return m.creator === user.username;
}

// Xoá biên bản họp là "quyền tối cao" — chỉ Admin (khoá lại cho người dùng thường, kể cả người tạo).
function canDeleteMeetingMinutesRecord(user) {
  return !!user?.perms?.admin;
}

function canDownloadMeetingMinutesRecord(user, m) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (user.perms?.minutesDownload) return true;
  return m.creator === user.username;
}

function canAccessReportsModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  return hasModuleAccess(user, 'reports') && !!user.perms?.canViewReports;
}

// Truyền thông nội bộ: XEM và tương tác (bình luận/thả tim) mở cho MỌI người dùng đã đăng nhập —
// đây là kênh thông tin toàn công ty, không giới hạn theo phòng ban như các module nghiệp vụ khác.
// "Góc chia sẻ" ai cũng đăng được tự do (không cần quyền riêng); Nhịp Sống HCRC/Đào tạo/Khen thưởng chỉ
// người được admin cấp quyền (hoặc admin) mới đăng bài được, để tránh loạn nội dung công khai.
function canCreateInternalPost(user, type) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (type === 'SHARE') return true;
  if (type === 'NEWS') return !!user.perms?.internalNewsCreate;
  if (type === 'TRAINING') return !!user.perms?.trainingManage;
  return false;
}

// Bài Góc Chia Sẻ (SHARE) ai cũng đăng được nhưng cần người có quyền internalPostApprove (hoặc admin)
// duyệt trước khi công khai — status PENDING/APPROVED/REJECTED do SERVER gán (xem
// lib/createValidation.js), client chỉ dùng để quyết định hiện nút Duyệt/Từ chối và ẩn bài chưa duyệt
// khỏi người không liên quan (không phải tác giả, không phải người duyệt).
function canApproveInternalPost(user) {
  return !!(user?.perms?.admin || user?.perms?.internalPostApprove);
}

const INTERNAL_TYPE_LABELS = { NEWS: 'Nhịp Sống HCRC', TRAINING: 'Đào Tạo', REWARD: 'Khen Thưởng', SHARE: 'Góc Chia Sẻ' };
const INTERNAL_TYPE_PREFIX = { NEWS: 'TN', TRAINING: 'DT', REWARD: 'KT', SHARE: 'CS' };

function getOfficeWorkflowMap(subType) {
  if (subType === 'SUA_CHUA') return DB.officeFixDeptWorkflows;
  return DB.officeBuyDeptWorkflows;
}

function canAccessOfficeSubTab(user, subType) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (subType === 'MUA_BAN' && !user.perms?.officeBuy) return false;
  if (subType === 'SUA_CHUA' && !user.perms?.officeFix) return false;
  return scopeHasAny(user, user.perms?.officeView) || isApproverInWorkflowMap(getOfficeWorkflowMap(subType), user.username);
}

function canAccessOfficeModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (!hasModuleAccess(user, 'office')) return false;
  return !!(user.perms?.officeBuy || user.perms?.officeFix);
}

function getUserAllowedDepts(user) {
  if (!user) return [];
  if (user.perms?.admin) return [...DB.depts];
  let allowed = new Set();
  if (user.dept) allowed.add(user.dept);
  if (user.perms?.uploadDepts) user.perms.uploadDepts.forEach(d => allowed.add(d));
  if (user.perms?.viewDraftDepts) user.perms.viewDraftDepts.forEach(d => allowed.add(d));
  if (user.perms?.viewApprovedDepts) user.perms.viewApprovedDepts.forEach(d => allowed.add(d));
  if (allowed.size === 0) return [...DB.depts];
  return Array.from(allowed);
}

// Kiểm tra quyền TẢI TỆP ĐÍNH KÈM. Người tạo/tải lên luôn được tải lại bản của chính mình.
// CẬP NHẬT: quyền Tải xuống trước đây là 1 cờ DÙNG CHUNG cho mọi module (downloadAll/downloadDepts)
// — cấp cho ai đó ở module Tài liệu vô tình cũng cho họ tải luôn ở Hợp đồng/Xe/Văn phòng. Nay tách
// riêng theo từng module (docDownload/submissionDownload/contractDownload/carDownload/
// officeDownload), moduleKey ứng với 1 trong 5 giá trị: 'doc'|'submission'|'contract'|'car'|'office'.
function canDownloadFile(user, moduleKey, dept, ownerUsername) {
  if (!user) return false;
  if (ownerUsername && ownerUsername === user.username) return true;
  return scopeAllows(user, user.perms?.[`${moduleKey}Download`], dept);
}

// Bộ quyền mặc định AN TOÀN cho user mới (tạo tay hoặc import CSV): mặc định KHÔNG cấp quyền
// xem/tạo liên phòng ban nào — mỗi người chỉ thao tác trong phạm vi phòng ban của chính mình
// (do scopeAllows/scopeHasAny/getScopedDepts luôn ngầm định cho phép phòng ban của bản thân).
// Trước đây user mới được bật sẵn hầu hết các module nghiệp vụ trên toàn công ty — không an toàn.
function defaultModuleAccess() {
  const ma = {};
  BUSINESS_MODULES.forEach(m => { ma[m.key] = true; });
  return ma;
}

function defaultNewUserPerms() {
  const emptyScope = () => ({ all: false, depts: [] });
  return {
    admin: false,
    moduleAccess: defaultModuleAccess(),
    canBeApprover: false,
    canViewReports: false,
    internalNewsCreate: false, internalRecruitmentCreate: false,
    trainingManage: false, trainingInstruct: false, onboardingEvaluate: false,
    internalPostApprove: false,
    uploadAll: false, uploadDepts: [],
    viewDraftAll: false, viewDraftDepts: [],
    viewApprovedAll: false, viewApprovedDepts: [],
    docDownload: emptyScope(),
    submissionView: emptyScope(), submissionCreate: emptyScope(), submissionDownload: emptyScope(),
    contractView: emptyScope(), contractCreate: emptyScope(), contractDownload: emptyScope(), contractApprove: false,
    paymentManage: false,
    vppManage: false, vppRegisterCreate: false,
    reportManage: false, reportAggregate: false, reportEntryCreate: false,
    meetingView: emptyScope(), meetingBookScope: emptyScope(),
    meetingApprove: false, meetingCancel: false,
    carView: emptyScope(), carCreate: emptyScope(), carDownload: emptyScope(), carDispatch: false,
    officeView: emptyScope(), officeCreate: emptyScope(), officeDownload: emptyScope(),
    officeBuy: true, officeFix: true,
    minutesCreate: false, minutesView: false, minutesEdit: false, minutesDownload: false,
    taskView: false, taskEdit: false, taskDelete: false, taskDownload: false,
    itPriceProposeCreate: false, itManage: false, itPriceEmergencyRejectApprove: false,
    uniformManage: false, uniformApprove: false, uniformStoreManage: false,
    budgetManage: false, budgetCreate: false, budgetAggregate: false,
    approverAuthLevel: 'NONE'
  };
}

// "Rỗng/không có quyền" theo TỪNG KIỂU dữ liệu perms hiện có trong hệ thống — dùng để coi
// basePerms[key]===undefined (nhóm được lưu TỪ TRƯỚC KHI có quyền này, vd nhóm cũ trước khi thêm
// module Giấy Phép) là TƯƠNG ĐƯƠNG "chưa cấp" với formPerms[key] rỗng, thay vì lệch nhau giả tạo.
function isEmptyPermValue(v) {
  if (v === undefined || v === null || v === false || v === '' || v === 'NONE') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object' && ('all' in v || 'depts' in v)) return !v.all && (!v.depts || v.depts.length === 0);
  return false;
}

// So sánh perms trên form với perms NỀN của 1 nhóm phân quyền -> trả về CHỈ những trường khác nhau
// (giá trị đầy đủ tại trường đó, so sánh ở cấp 1, không so sánh sâu hơn bên trong từng trường) — dùng
// làm "quyền tuỳ chỉnh riêng" (permOverrides) của người dùng, tách biệt khỏi phần thừa hưởng từ nhóm,
// để khi nhóm đổi quyền sau này vẫn tự động cập nhật đúng cho người này mà không mất phần tuỳ chỉnh.
// basePerms[key]===undefined + formPerms[key] rỗng KHÔNG được ghi vào overrides (xem isEmptyPermValue())
// — nếu không, thêm 1 quyền MỚI vào hệ thống (collectPermsFromForm() luôn trả field đó, kể cả false) sẽ
// tự động ghi đè "false" thành override RIÊNG cho MỌI người dùng có nhóm được lưu trước đó, khiến người
// đó VĨNH VIỄN không thừa hưởng được quyền mới dù sau này nhóm được bật quyền đó lên.
function diffPerms(formPerms, basePerms) {
  const overrides = {};
  Object.keys(formPerms || {}).forEach(key => {
    const baseVal = basePerms ? basePerms[key] : undefined;
    if (baseVal === undefined && isEmptyPermValue(formPerms[key])) return;
    if (JSON.stringify(formPerms[key]) !== JSON.stringify(baseVal)) {
      overrides[key] = formPerms[key];
    }
  });
  return overrides;
}

// Áp phần quyền tuỳ chỉnh riêng (overrides) lên trên nền quyền của nhóm -> ra quyền hiệu lực thực tế
// (user.perms) — dùng cho MỌI hàm kiểm tra quyền trong ứng dụng, nên luôn phải tính lại giá trị này
// mỗi khi lưu người dùng HOẶC lưu nhóm phân quyền (xem saveUser()/savePermGroup()).
function mergePerms(basePerms, overrides) {
  return { ...(basePerms || {}), ...(overrides || {}) };
}

const APPROVER_AUTH_LEVEL_RANK = { NONE: 0, PASSWORD: 1, PIN: 2, WEBAUTHN: 3 };

// Gộp quyền NỀN của NHIỀU nhóm phân quyền đã gán cho 1 người (chọn được nhiều nhóm cùng lúc, xem
// uPermGroupsChecklist) thành 1 quyền nền duy nhất, TRƯỚC KHI áp permOverrides như cũ qua mergePerms()
// — kết hợp theo kiểu dữ liệu từng trường: boolean lấy OR (được cấp ở BẤT KỲ nhóm nào là đủ), scope
// {all,depts} lấy hợp (union) depts + OR cờ "all", approverAuthLevel lấy mức CAO NHẤT trong các nhóm
// (an toàn hơn — không để 1 nhóm yêu cầu xác thực thấp vô tình hạ mức của nhóm khác). Không có nhóm nào
// -> trả về {} (quyền hoàn toàn riêng, dùng thẳng formPerms). Cùng thuật toán với mergeGroupsBasePermsServer
// ở routes/data.js — PHẢI giữ giống hệt nếu sửa 1 bên.
function mergeGroupsBasePerms(groupsPerms) {
  const list = (groupsPerms || []).filter(Boolean);
  if (!list.length) return {};
  const keys = new Set();
  list.forEach(p => Object.keys(p || {}).forEach(k => keys.add(k)));
  const result = {};
  keys.forEach(key => {
    const values = list.map(p => p?.[key]);
    if (key === 'approverAuthLevel') {
      result[key] = values.reduce((best, v) =>
        (APPROVER_AUTH_LEVEL_RANK[v] || 0) > (APPROVER_AUTH_LEVEL_RANK[best] || 0) ? v : best, 'NONE');
      return;
    }
    const sample = values.find(v => v !== undefined && v !== null);
    if (typeof sample === 'boolean') {
      result[key] = values.some(v => v === true);
    } else if (sample && typeof sample === 'object' && !Array.isArray(sample) && ('all' in sample || 'depts' in sample)) {
      result[key] = { all: values.some(v => v?.all === true), depts: [...new Set(values.flatMap(v => v?.depts || []))] };
    } else {
      result[key] = values[values.length - 1];
    }
  });
  return result;
}

// Chuyển đổi perms kiểu CŨ (cờ bật/tắt toàn công ty: submissionModule, contractModule, carModule,
// meetingBook dạng boolean) sang mô hình MỚI theo phòng ban ({all, depts}) — không âm thầm bớt
// quyền của user đang có: nếu cờ cũ = true thì phạm vi mới quy đổi thành "Tất cả phòng ban" (all:
// true) để giữ nguyên đúng quyền hiện có; nếu = false/chưa có thì quy đổi thành rỗng (chỉ còn quyền
// mặc định trong phòng ban của chính họ). Hàm idempotent — gọi lại nhiều lần không đổi kết quả.
function migrateLegacyPerms(perms) {
  if (!perms || typeof perms !== 'object') return { perms, changed: false };
  const p = { ...perms };
  let changed = false;
  const scopeFromFlag = (flag) => ({ all: !!flag, depts: [] });

  if (p.submissionView === undefined) {
    p.submissionView = scopeFromFlag(p.submissionModule);
    p.submissionCreate = scopeFromFlag(p.submissionModule);
    delete p.submissionModule;
    changed = true;
  }
  if (p.contractView === undefined) {
    p.contractView = scopeFromFlag(p.contractModule);
    p.contractCreate = scopeFromFlag(p.contractModule);
    delete p.contractModule;
    changed = true;
  }
  if (p.carView === undefined) {
    p.carView = scopeFromFlag(p.carModule);
    p.carCreate = scopeFromFlag(p.carModule);
    delete p.carModule;
    changed = true;
  }
  if (p.meetingView === undefined) {
    p.meetingView = scopeFromFlag(p.meetingBook || p.meetingApprove || p.meetingCancel);
    p.meetingBookScope = scopeFromFlag(p.meetingBook);
    delete p.meetingBook;
    changed = true;
  }
  if (p.officeView === undefined) {
    const anyOffice = !!(p.officeBuy || p.officeFix);
    p.officeView = scopeFromFlag(anyOffice);
    p.officeCreate = scopeFromFlag(anyOffice);
    changed = true;
  }
  // Biên bản họp trước đây phân quyền Xem/Tạo theo phòng ban ({all, depts}), nay chuyển thành 1
  // quyền "Được lập biên bản họp" dạng boolean đơn giản (XEM giờ mở cho mọi người, không còn theo
  // phòng ban — bản thân biên bản họp cũng không còn trường phòng ban). Quy đổi: có quyền cũ (ALL
  // hoặc có ít nhất 1 phòng ban) -> giữ nguyên true để không ai bị mất quyền đang có.
  if (typeof p.minutesCreate !== 'boolean') {
    const oldCreate = p.minutesCreate;
    p.minutesCreate = !!(oldCreate?.all || (Array.isArray(oldCreate?.depts) && oldCreate.depts.length > 0));
    delete p.minutesView;
    changed = true;
  }
  // Quyền "Tải xuống" trước đây DÙNG CHUNG cho mọi module (downloadAll/downloadDepts) — quy đổi
  // giữ nguyên phạm vi cũ sang CẢ 5 quyền tải mới theo từng module, để không ai bị mất quyền tải
  // đang có; sau đó admin có thể tinh chỉnh lại riêng cho từng module nếu muốn thu hẹp.
  if (p.docDownload === undefined) {
    const dlScope = scopeFromFlag(p.downloadAll);
    dlScope.depts = Array.isArray(p.downloadDepts) ? [...p.downloadDepts] : [];
    p.docDownload = { ...dlScope, depts: [...dlScope.depts] };
    p.submissionDownload = { ...dlScope, depts: [...dlScope.depts] };
    p.contractDownload = { ...dlScope, depts: [...dlScope.depts] };
    p.carDownload = { ...dlScope, depts: [...dlScope.depts] };
    p.officeDownload = { ...dlScope, depts: [...dlScope.depts] };
    delete p.downloadAll;
    delete p.downloadDepts;
    changed = true;
  }
  // Quyền truy cập module (bật/tắt độc lập, không cần admin) — user cũ chưa có trường này thì mặc
  // định BẬT ở mọi module để giữ nguyên hành vi/quyền truy cập đang có, admin có thể tắt bớt sau.
  if (p.moduleAccess === undefined) {
    p.moduleAccess = defaultModuleAccess();
    changed = true;
  }
  // Mức xác thực bổ sung khi bấm Duyệt (nhập lại mật khẩu / OTP email) — user cũ chưa có trường này
  // thì mặc định KHÔNG yêu cầu thêm gì (giữ nguyên trải nghiệm hiện tại), admin bật riêng sau.
  if (p.approverAuthLevel === undefined) {
    p.approverAuthLevel = 'NONE';
    changed = true;
  }
  // Mục "Khen Thưởng" trong Truyền Thông Nội Bộ đã đổi thành "Tuyển Dụng" — quyền đăng bài đổi tên
  // internalRewardCreate -> internalRecruitmentCreate, quy đổi giữ nguyên để ai đã có quyền cũ không
  // bị mất quyền đăng tin tuyển dụng.
  if (p.internalRecruitmentCreate === undefined && p.internalRewardCreate !== undefined) {
    p.internalRecruitmentCreate = p.internalRewardCreate;
    delete p.internalRewardCreate;
    changed = true;
  }
  // Đợt 3 (Phân quyền + Vòng đời Đào Tạo): cờ internalTrainingCreate cũ (đăng bài Đào tạo + toàn bộ
  // quản lý LMS: tạo lớp/tài liệu/bài test/lộ trình) tách thành trainingManage (giữ nguyên toàn bộ
  // quyền cũ) + trainingInstruct (quyền MỚI, mặc định KHÔNG bật cho ai — chỉ admin cấp riêng cho giảng
  // viên được gán theo từng lớp, xem canManageTrainingClass() ở lib/recordActions.js) — quy đổi giữ
  // nguyên để ai đã có quyền cũ không bị mất quyền quản lý đào tạo đang có.
  if (p.trainingManage === undefined && p.internalTrainingCreate !== undefined) {
    p.trainingManage = p.internalTrainingCreate;
    delete p.internalTrainingCreate;
    changed = true;
  }

  return { perms: p, changed };
}

// ==========================================
// KẾT NỐI DỮ LIỆU: đã chuyển từ localStorage sang API backend (Node.js + MSSQL)
// Toàn bộ dữ liệu mặc định (depts, cats, workflows, users...) giờ được khởi tạo (seed)
// một lần duy nhất ở phía Server (xem file server/seedDefaults.js), không còn seed ở Client.
// ==========================================
async function initDatabase(loggingInUser) {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    DB.depts = data.depts || [];
    DB.stores = data.stores || [];
    DB.cats = data.cats || [];
    DB.deptAbbrs = data.deptAbbrs || {};
    DB.docCatAbbrs = data.docCatAbbrs || {};
    DB.contractTypeAbbrs = data.contractTypeAbbrs || {};
    DB.jobTitles = data.jobTitles || [];
    DB.storeJobTitles = data.storeJobTitles || [];
    DB.submissionTypes = data.submissionTypes || [];
    DB.contractTypes = data.contractTypes || [];
    DB.carTypes = data.carTypes || [];
    DB.itTicketCategories = data.itTicketCategories || [];
    DB.uniformCatalog = data.uniformCatalog || [];

    // Di trú phân quyền cũ (cờ bật/tắt toàn công ty theo module) sang mô hình mới theo phòng ban.
    // Nếu có user nào được chuyển đổi, lưu lại ngay lên server để không phải di trú lại mỗi lần tải
    // trang — nhưng chỉ khi người vừa đăng nhập là Admin, vì ghi "users" giờ yêu cầu quyền Admin ở
    // server (trước đây API không có xác thực nên ai load trang cũng lưu được).
    let permsMigrated = false;
    // moduleApproverUsernames (routes/data.js computeModuleApproverUsernames()): danh sách username
    // đang giữ 1 cờ quyền phê duyệt cụ thể (meetingApprove/internalPostApprove/
    // itPriceEmergencyRejectApprove/licenseApprove), server tính sẵn từ perms ĐẦY ĐỦ trước khi ẩn bớt —
    // vì "perms" của người KHÁC không còn được trả nguyên cho tài khoản thường nữa (chỉ admin + chính
    // mình mới thấy đủ, xem routes/data.js sanitizeUsersPermsForViewer()), 4 hàm getXApproverUsernames()
    // bên dưới đọc từ đây thay vì tự quét DB.users[].perms như trước.
    DB.moduleApproverUsernames = data.moduleApproverUsernames || {};
    // groupId (1 nhóm duy nhất) -> groupIds (chọn được nhiều nhóm cùng lúc) — user cũ tạo trước tính
    // năng multi-select chỉ có field "groupId" đơn, quy đổi 1 LẦN ở đây thành mảng 1 phần tử để mọi nơi
    // khác trong code chỉ cần đọc "groupIds" là đủ (không phải rải fallback groupId||groupIds khắp nơi).
    DB.users = (data.users || []).map(u => {
      const { perms, changed } = migrateLegacyPerms(u.perms);
      if (changed) permsMigrated = true;
      const needsGroupIdsMigration = !u.groupIds && u.groupId;
      if (needsGroupIdsMigration) permsMigrated = true;
      if (!changed && !needsGroupIdsMigration) return u;
      return { ...u, ...(changed && { perms }), groupIds: u.groupIds || (u.groupId ? [u.groupId] : []) };
    });
    if (permsMigrated && loggingInUser?.perms?.admin) {
      console.log('ℹ️ Đã tự động chuyển đổi phân quyền người dùng sang mô hình theo phòng ban (module-level).');
      // silent:true — đây là lưu NGẦM tự động, người dùng không hề bấm gì; nếu 2 tab/thiết bị admin
      // cùng đăng nhập gần như đồng thời thì tab thua cuộc gặp 409 là bình thường (tab kia đã lưu đúng
      // kết quả di trú rồi, không mất dữ liệu gì) — không được phép hiện alert chặn màn hình cho việc
      // này, kẻo người dùng tưởng lỗi trong khi họ chẳng thao tác gì cả.
      syncStorage('users', { silent: true });
    }

    DB.docs = data.docs || [];
    DB.submissions = data.submissions || [];
    DB.contracts = data.contracts || [];
    DB.meetings = data.meetings || [];
    DB.carRegs = data.carRegs || [];
    DB.officeReqs = data.officeReqs || [];
    DB.meetingMinutes = data.meetingMinutes || [];
    DB.meetingAttendeeTemplates = data.meetingAttendeeTemplates || [];
    DB.tasks = data.tasks || [];
    DB.internalPosts = data.internalPosts || [];
    DB.internalNewsCategories = data.internalNewsCategories || [];
    DB.internalShareCategories = data.internalShareCategories || [];
    DB.paymentRequests = data.paymentRequests || [];
    DB.workflows = data.workflows || [];
    DB.formTemplates = data.formTemplates || {};
    DB.permGroups = data.permGroups || [];
    DB.vppExcludeGroups = data.vppExcludeGroups || [];
    DB.vppExcludedJobTitles = data.vppExcludedJobTitles || [];
    DB.workflowParticipatingDepts = data.workflowParticipatingDepts || [];
    DB.pwaShortcutModules = data.pwaShortcutModules || [];
    // Sửa lỗi cũ: 2 dòng dưới đây trước nay CHƯA từng được gán từ data (chỉ có nhánh khởi tạo lười
    // "|| {}" ngay tại chỗ đọc — xem toggleUploadTypeExt()/renderUploadTypeConfig()), khiến màn "Quản
    // Lý Tệp File" luôn hiện lại từ đầu như CHƯA cấu hình gì mỗi lần tải lại trang dù đã lưu — server
    // vẫn chặn đúng do tự đọc thẳng DB (getAppDataValueCached), chỉ riêng client hiển thị sai.
    DB.uploadFileTypeConfig = data.uploadFileTypeConfig || {};
    DB.uploadSizeLimitConfig = data.uploadSizeLimitConfig || {};
    // Mẫu Giá giờ chỉ còn columns[] (khuôn cột, không còn dữ liệu giá thật) — nhẹ, trả nguyên qua
    // GET /api/data như mọi collection khác, không cần lọc bớt như thiết kế cũ.
    DB.itPriceMasterLists = data.itPriceMasterLists || [];
    DB.emailConfig = data.emailConfig || {};
    // externalApiKeys: server tự trả mảng RỖNG cho non-admin (ẩn hoàn toàn, xem
    // sanitizeExternalApiKeys() ở routes/data.js) — không cần lọc gì thêm ở client.
    DB.externalApiKeys = data.externalApiKeys || [];
    // Nhật ký hệ thống KHÔNG còn tải kèm trong GET /api/data (trước đây trả sẵn cho MỌI người đăng
    // nhập dù chỉ admin mới thấy được màn Nhật ký — lộ dữ liệu qua API dù giao diện đã ẩn) — giờ tải
    // riêng qua GET /api/log (chỉ admin gọi được) đúng lúc mở tab Nhật ký, xem loadSystemLogs().
    DB.systemLogs = [];

    DB.deptWorkflows = data.deptWorkflows || {};
    DB.submissionDeptWorkflows = data.submissionDeptWorkflows || {};
    DB.submissionTypeDeptWorkflows = data.submissionTypeDeptWorkflows || {};
    DB.submissionApprovalGroups = migrateSubmissionApprovalGroupKeys(data.submissionApprovalGroups || {});
    DB.carDeptWorkflows = data.carDeptWorkflows || {};

    DB.officeBuyDeptWorkflows = data.officeBuyDeptWorkflows || {};
    DB.officeFixDeptWorkflows = data.officeFixDeptWorkflows || {};
    DB.vppDeptWorkflows = data.vppDeptWorkflows || {};
    DB.itPriceDeptWorkflows = data.itPriceDeptWorkflows || {};
    DB.itPriceTierWorkflows = data.itPriceTierWorkflows || {};
    // Sửa lỗi cũ tương tự uploadFileTypeConfig/uploadSizeLimitConfig ở trên: 3 dòng dưới đây trước nay
    // CHƯA từng được gán từ data (server đã trả đúng — xem routes/data.js — nhưng client không đọc vào),
    // khiến "Nhóm Phê Duyệt HĐ" (mục 14 Phân Quyền) không vẽ được ô chọn người (renderContractApprovalGroups()
    // truy cập DB.contractApprovalGroups[key] trên giá trị undefined, ném lỗi và dừng cả vòng lặp render
    // giữa chừng), và cấu hình quy trình Hợp Đồng theo phòng ban (mục 13, 2 khối "Hợp đồng - Phê duyệt"/
    // "Hợp đồng - Quản Lý HĐ") luôn hiện lại như chưa cấu hình gì mỗi lần tải lại trang.
    DB.contractApprovalGroups = data.contractApprovalGroups || {};
    DB.contractApprovalDeptWorkflows = data.contractApprovalDeptWorkflows || {};
    DB.contractManageDeptWorkflows = data.contractManageDeptWorkflows || {};

    DB.vppPeriods = data.vppPeriods || [];
    DB.vppRegistrations = data.vppRegistrations || [];

    DB.reportPeriods = data.reportPeriods || [];
    DB.reportEntries = data.reportEntries || [];

    DB.trainingCategories = data.trainingCategories || [];
    DB.trainingDocuments = data.trainingDocuments || [];
    DB.trainingClasses = data.trainingClasses || [];
    DB.trainingRegistrations = data.trainingRegistrations || [];
    DB.careerPaths = data.careerPaths || [];
    DB.careerPathConfirmations = data.careerPathConfirmations || [];
    DB.trainingTests = data.trainingTests || [];
    DB.trainingTestSubmissions = data.trainingTestSubmissions || [];
    DB.trainingDocumentProgress = data.trainingDocumentProgress || [];
    DB.trainingCourses = data.trainingCourses || [];
    DB.trainingPlans = data.trainingPlans || [];
    DB.recruitmentJobs = data.recruitmentJobs || [];
    DB.recruitmentReferrals = data.recruitmentReferrals || [];
    DB.sensitiveKeywords = data.sensitiveKeywords || [];
    DB.itPriceApprovals = data.itPriceApprovals || [];
    DB.itSupportTickets = data.itSupportTickets || [];
    DB.uniformPeriods = data.uniformPeriods || [];
    DB.uniformIssuances = data.uniformIssuances || [];
    DB.uniformStockAdjustments = data.uniformStockAdjustments || [];
    DB.uniformTransfers = data.uniformTransfers || [];
    DB.budgetDeptWorkflows = data.budgetDeptWorkflows || {};
    DB.budgetTemplates = data.budgetTemplates || [];
    DB.budgetPeriods = data.budgetPeriods || [];
    DB.budgetEntries = data.budgetEntries || [];

    DB.operationOrderDeptWorkflows = data.operationOrderDeptWorkflows || {};
    DB.operationStoreOpenDeptWorkflows = data.operationStoreOpenDeptWorkflows || {};
    DB.operationRepairDeptWorkflows = data.operationRepairDeptWorkflows || {};
    // Giai đoạn Dự toán (tab "🏬 Siêu Thị") — 2 map quy trình duyệt RIÊNG (song song, không dùng chung
    // operationStoreOpenDeptWorkflows/operationRepairDeptWorkflows ở trên), xem lib/workflowEngine.js
    // operationStoreOpeningEstimate/operationRepairEstimate.
    DB.operationStoreOpenEstimateDeptWorkflows = data.operationStoreOpenEstimateDeptWorkflows || {};
    DB.operationRepairEstimateDeptWorkflows = data.operationRepairEstimateDeptWorkflows || {};
    DB.operationOrders = data.operationOrders || [];
    DB.operationStoreOpenings = data.operationStoreOpenings || [];
    DB.operationRepairs = data.operationRepairs || [];
    // Cây công việc Thực hiện/Nghiệm thu — nguồn riêng dbo.OperationWorkItems (không nằm trong
    // dbo.AppData), cùng khuôn DB.tasks ở dưới.
    DB.operationWorkItems = data.operationWorkItems || [];
    // Kỳ Thực Hiện — mỗi hồ sơ Mở mới/Sửa chữa có danh sách kỳ riêng (dbo.Records, qua engine chung).
    DB.operationExecutionPeriods = data.operationExecutionPeriods || [];

    DB.licenses = data.licenses || [];
    DB.licenseTypes = data.licenseTypes || [];

    DB.itServiceRenewals = data.itServiceRenewals || [];

    // hrFeedback (Nhân Sự — HCRC Đồng Hành): server đã lọc sẵn theo quyền xem (chính người hỏi hoặc
    // Nhân Sự) trước khi trả về — xem filterHrFeedbackForUser() ở lib/recordViewScope.js.
    DB.hrFeedback = data.hrFeedback || [];

    DB._versions = data._versions || {};

    applyAllCoreFieldCustomizations();
  } catch (e) {
    console.error('Lỗi khi tải dữ liệu từ máy chủ (API /api/data):', e);
    alert('⛔ Không thể kết nối tới máy chủ dữ liệu (MSSQL API). Vui lòng kiểm tra lại kết nối / liên hệ Quản trị viên.\n\nChi tiết lỗi: ' + e.message);
  }
}

// Phiên đăng nhập hết hạn/không hợp lệ giữa lúc đang dùng (cookie hết hạn, hoặc bị admin đổi mật
// khẩu ở nơi khác...) — đưa về màn hình đăng nhập thay vì cứ báo lỗi HTTP 401 chung chung khó hiểu.
function handleSessionExpired() {
  if (!currentUser) return; // đã ở màn đăng nhập rồi, tránh hiện alert lặp lại
  logout();
  alert('⛔ Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
}

// Gọi API xử lý quy trình duyệt THẬT ở server (Bước 1 — xem routes/workflow.js/lib/workflowEngine.js)
// — trước đây "duyệt hồ sơ" chỉ là client tự tính toán đúng/sai bước rồi POST đè nguyên collection,
// server không xác minh lại gì cả. Giờ server tự kiểm tra người gọi có đúng là approver ở đúng bước
// hiện tại hay không, tự tính chuyển bước/hoàn tất, rồi trả về hồ sơ mới nhất + mô tả kết quả
// (transition) để client build đúng thông báo/side-effect (email, tự tạo Công việc...) như trước.
async function callWorkflowAction(moduleKey, id, action, payload) {
  const res = await fetch(`/api/workflow/${moduleKey}/${id}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  if (res.status === 401) {
    handleSessionExpired();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body; // { ok, item, transition }
}

// Gọi API tạo hồ sơ mới THẬT ở server (Bước 2 — xem routes/create.js/lib/createValidation.js) — server
// tự xác minh phạm vi phòng ban + tự gán người tạo từ phiên đăng nhập, không tin field dept/creator
// client gửi lên nữa (trước đây chỉ lọc dropdown ở giao diện, 1 request tự soạn vẫn tạo được hồ sơ
// cho phòng ban bất kỳ). Trả về đúng bản ghi server đã lưu (id/creator là giá trị THẬT, không phải
// giá trị client tạm tính).
async function callCreateAction(moduleKey, payload) {
  const res = await fetch(`/api/create/${moduleKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (res.status === 401) {
    handleSessionExpired();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body; // { ok, item }
}

async function callMeetingAction(id, action) {
  const res = await fetch(`/api/meetings/${id}/${action}`, { method: 'POST' });
  if (res.status === 401) {
    handleSessionExpired();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body; // { ok, item }
}

// Bước 2b: sửa/xóa/giao hồ sơ đã tồn tại (Hợp đồng, Biên bản họp, Công việc) — xem routes/records.js.
async function callRecordAction(module, id, action, payload) {
  const res = await fetch(`/api/records/${module}/${id}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  if (res.status === 401) {
    handleSessionExpired();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body; // { ok, item? }
}

// Kế toán tự khởi tạo đề nghị thanh toán có nguồn (Hợp Đồng/Mua Sắm/Sửa Chữa/Đầu Tư) ngay từ module
// Thanh Toán — khớp POST /api/records/paymentRequests/from-source ở routes/records.js. Không dùng
// callRecordAction() (khuôn module/id/action) vì route này không thao tác trên 1 paymentRequests id có
// sẵn, cũng không dùng callRecordCreate() (khuôn tạo thủ công /api/records/<module>) vì cần thêm
// sourceModule/sourceId trong payload.
async function callCreatePaymentRequestFromSource(payload) {
  const res = await fetch('/api/records/paymentRequests/from-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  if (res.status === 401) {
    handleSessionExpired();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body; // { ok, item, paymentRequest }
}

// Bước 4: tạo mới Biên bản họp/Công việc — khác callRecordAction() (không thao tác trên 1 id có sẵn).
async function callRecordCreate(module, payload) {
  const res = await fetch(`/api/records/${module}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  if (res.status === 401) {
    handleSessionExpired();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body; // { ok, item, createdTasks? }
}

// Hàng đợi request lưu THEO TỪNG KEY — nếu syncStorage("users") được gọi lần nữa trong khi lượt gọi
// trước ĐÓ VẪN CHƯA CÓ PHẢN HỒI (vd admin sửa xong 1 người rồi bấm Khóa/Mở ngay người kế tiếp, hoặc
// bấm 2-3 thao tác liên tiếp trong Danh Sách Người Dùng), request sau phải ĐỢI request trước cập nhật
// xong DB._versions[key] rồi mới gửi — nếu không, cả 2 request cùng mang If-Match là PHIÊN BẢN CŨ (đọc
// từ lúc tải trang), request thứ 2 tới server SAU khi request thứ 1 đã ghi xong sẽ bị từ chối 409 "vừa
// bị người khác thay đổi" dù thực ra chỉ có đúng 1 admin thao tác liên tục — đây chính là nguyên nhân
// hay gặp báo lỗi lưu khi thao tác nhanh liên tiếp ở màn Người Dùng. Xếp hàng theo key (không khoá lẫn
// giữa "users" và "permGroups" chẳng hạn) để không làm chậm các key không liên quan.
const syncStorageQueues = {};

// silent=true: dùng cho các lượt lưu TỰ ĐỘNG chạy ngầm, người dùng không hề bấm nút lưu nào (hiện chỉ
// có đúng 1 chỗ — di trú phân quyền cũ tự lưu lại lúc initDatabase(), xem dưới) — 409/lỗi mạng ở đây
// KHÔNG được phép hiện alert chặn màn hình, vì người dùng không biết "vừa thao tác gì" mà lại thấy lỗi.
// Hàng đợi theo key (syncStorageQueues) chỉ tránh được race giữa các lượt lưu TRONG CÙNG 1 tab — 409
// vẫn có thể xảy ra bình thường khi 2 tab/thiết bị admin cùng tự động di trú gần như đồng thời lúc mới
// đăng nhập (mỗi tab có DB._versions riêng); do di trú là thao tác idempotent, tab thua cuộc không mất
// gì cả — dữ liệu đã migrate đúng vẫn đang nằm trên server (do tab kia vừa ghi), im lặng bỏ qua là đủ.
function syncStorageOnce(key, silent) {
  // If-Match: version đọc gần nhất (nếu có) — cho server biết "tôi đang ghi dựa trên bản đã đọc
  // này", để phát hiện nếu người khác ghi đè "${key}" ở nơi khác sau đó (xem routes/data.js).
  // Lần đầu (chưa từng có version, vd. vừa tạo collection mới) thì bỏ qua, ghi vô điều kiện như cũ.
  const headers = { 'Content-Type': 'application/json' };
  const knownVersion = DB._versions?.[key];
  if (knownVersion) headers['If-Match'] = knownVersion;

  // "users": mustChangePassword do SERVER tự quản lý hoàn toàn (đặt true khi admin gõ mật khẩu tạm mới,
  // gỡ khi chính user đó tự đổi mật khẩu — xem prepareUsersForSave()/PATCH /api/auth/me), nhưng vẫn giữ
  // lại trong response GET /api/data để hiện badge "Chưa đổi mật khẩu tạm" ở màn quản lý người dùng —
  // nghĩa là DB.users ở trình duyệt LUÔN cầm 1 bản chụp có thể đã CŨ (VD user vừa tự đổi mật khẩu ở tab
  // khác, gỡ cờ này server-side, nhưng admin đang mở sẵn màn Người Dùng chưa tải lại trang). Trước đây
  // saveUser() sửa 1 field bất kỳ (VD số điện thoại) rồi gửi NGUYÊN mảng DB.users lên — vì user.
  // mustChangePassword vẫn có giá trị định sẵn (không phải "undefined"), điều kiện khôi phục ở server
  // (u.mustChangePassword === undefined) không được kích hoạt, ghi ĐÈ NHẦM cờ cũ (true) lên, âm thầm
  // buộc user đó phải đổi mật khẩu lại dù họ đã tự đổi xong trước đó. Bỏ hẳn field này khỏi payload gửi
  // lên — để trống (undefined) luôn đúng nghĩa "không có gì để cập nhật, giữ nguyên giá trị server đang
  // có", khớp CHÍNH XÁC hành vi mà prepareUsersForSave() đã thiết kế sẵn.
  const payload = key === 'users'
    ? (DB.users || []).map(({ mustChangePassword, ...rest }) => rest)
    : DB[key];

  // Trả về true/false (đã lưu thành công hay không) — trước đây không trả về gì có ý nghĩa (luôn
  // resolve, kể cả khi 409/lỗi, vì .catch() bên dưới không throw lại) nên saveUser()/deleteUser() ở
  // dưới KHÔNG THỂ chờ rồi kiểm tra kết quả thật, chỉ có thể "bắn và quên" — hiện luôn alert "Đã lưu
  // thành công"/tự render lại danh sách như đã lưu xong NGAY LẬP TỨC, dù server sau đó có thể từ chối
  // (409 xung đột, hoặc 400 "không thể xoá admin cuối cùng").
  return fetch(`/api/data/${key}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  }).then(async res => {
    if (res.status === 401) { handleSessionExpired(); return false; }
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      if (silent) { console.warn(`Bỏ qua lưu ngầm "${key}" — đã bị nơi khác ghi trước:`, body.error); return false; }
      alert(`⚠️ ${body.error || `Dữ liệu "${key}" vừa bị người khác thay đổi — vui lòng tải lại trang.`}`);
      return false;
    }
    const body = await res.json().catch(() => ({}));
    // Trước đây lỗi 400/403 (VD "Chỉ Quản Trị Viên...", "...không còn tài khoản nào có quyền Quản Trị
    // Viên") bị nuốt mất, chỉ hiện "HTTP 400"/"HTTP 403" chung chung — người dùng không biết vì sao lưu
    // thất bại. Đọc đúng body.error server đã trả (route luôn trả {error: "..."} cho lỗi nghiệp vụ, xem
    // routes/data.js) trước khi rơi về thông báo mặc định.
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    if (body.version) DB._versions[key] = body.version;
    // Lưu "permGroups" đồng bộ lại "users" như tác dụng phụ ở server (xem routes/data.js) — server trả
    // kèm version MỚI của "users" sau khi đồng bộ, cập nhật ngay để lượt lưu "users" kế tiếp không bị
    // 409 giả do chính lượt lưu permGroups này gây ra (chứ không phải ai khác thực sự đổi "users").
    if (body.usersVersion) DB._versions.users = body.usersVersion;
    return true;
  }).catch(e => {
    console.error(`Lỗi khi lưu "${key}" lên máy chủ:`, e);
    if (silent) return false;
    alert(`⛔ Lỗi lưu dữ liệu "${key}" lên máy chủ: ` + e.message);
    return false;
  });
}

// Trả về Promise<boolean> (đã lưu thành công hay chưa) — chỉ để tiện await ở các thao tác cần biết
// chắc chắn đã lưu xong mới báo thành công/cập nhật giao diện (VD saveUser()/deleteUser()); các chỗ
// gọi "bắn và quên" khác trong file này không cần quan tâm giá trị trả về, vẫn hoạt động như cũ.
function syncStorage(key, opts) {
  const silent = !!opts?.silent;
  try {
    const previous = syncStorageQueues[key] || Promise.resolve();
    // .then(fn, fn): chạy lượt kế tiếp dù lượt trước lỗi/bị 409 — 1 lần lỗi không được phép chặn mãi
    // mãi các lượt lưu sau của cùng key.
    const next = previous.then(() => syncStorageOnce(key, silent), () => syncStorageOnce(key, silent));
    syncStorageQueues[key] = next;
    return next;
  } catch (e) {
    if (silent) { console.error('Lỗi lưu dữ liệu ngầm:', e); return Promise.resolve(false); }
    alert('Lỗi lưu dữ liệu: ' + e.message);
    return Promise.resolve(false);
  }
}

let dataReady = false;

// Ẩn màn chờ #bootSplash đi — xem chú thích đầy đủ tại chỗ khai báo #bootSplash (đầu <body>). Gọi từ
// CẢ 2 nhánh thoát của tryRestoreSession() (không còn phiên hợp lệ → lộ màn Đăng Nhập thật) VÀ
// proceedAfterAuth() (còn phiên hợp lệ → chuyển hẳn sang giao diện chính/hộp thoại bắt đổi mật khẩu) —
// idempotent, gọi thêm lần nữa (vd từ login() lúc đăng nhập thủ công, màn chờ đã ẩn từ trước) vô hại.
function hideBootSplash() {
  document.getElementById('bootSplash')?.classList.add('hidden');
}

// KHÔNG còn tải dữ liệu ngay khi mở trang — /api/data giờ bắt buộc đăng nhập (trước đây gọi thẳng ở
// đây vì GET /api/data không có xác thực gì, ai cũng gọi được). Chỉ còn thử khôi phục phiên đăng
// nhập cũ (nếu trình duyệt vẫn còn cookie hợp lệ từ lần trước, vd. tải lại trang) qua /api/auth/me —
// nếu không có/hết hạn thì lộ màn Đăng Nhập thật ra (thay cho #bootSplash), không báo lỗi.
(async function tryRestoreSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      hideBootSplash();
      document.getElementById('loginSection').classList.remove('hidden');
      return;
    }
    const user = await res.json();
    await proceedAfterAuth(user);
  } catch (e) {
    console.warn('Không thể khôi phục phiên đăng nhập cũ:', e.message);
    hideBootSplash();
    document.getElementById('loginSection').classList.remove('hidden');
  }
})();

// Hiện số phiên bản server ở góc màn hình (không cần đăng nhập) — cách nhanh nhất để xác nhận sau khi
// deploy code mới, server thật sự đang chạy đúng bản (so với package.json), tránh tình trạng tưởng đã
// cập nhật nhưng PM2 vẫn đang chạy tiến trình cũ do lỗi khi khởi động lại.
(async function loadAppVersion() {
  try {
    const res = await fetch('/api/health');
    const body = await res.json().catch(() => ({}));
    const badge = document.getElementById('appVersionBadge');
    if (badge && body.version) badge.textContent = `v${body.version}`;
  } catch (e) { /* im lặng — chỉ là thông tin phụ, không ảnh hưởng gì tới việc dùng app */ }
})();

// Gửi email THẬT qua backend (POST /api/send-email) nếu đã nhập SMTP Server ở màn Quản trị > Cấu
// Hình Email — chạy song song (fire-and-forget đối với luồng đang gọi: KHÔNG chặn hay đổi
// hành vi của thao tác đang thực hiện, vốn đã ghi log "đã thử gửi" + cập nhật UI ngay). Nhưng khác
// với trước đây, hàm này giờ CHỜ phản hồi thật từ backend rồi ghi THÊM 1 dòng Nhật ký hệ thống riêng
// xác nhận máy chủ SMTP đã cấu hình có thực sự nhận email hay không (xem logEmailDeliveryResult) —
// vì dòng log "đã thử gửi" ghi ngay lúc thao tác không phản ánh được điều đó.
function dispatchRealEmail(recipients, subject, bodyText, context) {
  const addresses = (recipients || []).map(r => (typeof r === 'string' ? r : r?.email)).filter(Boolean);
  if (addresses.length === 0) return;
  const ctxModule = (context && context.module) || 'EMAIL';
  const ctxTarget = (context && context.targetCode) || '';
  fetch('/api/send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: addresses, subject, text: bodyText })
  })
    .then(res => res.json())
    .then(result => logEmailDeliveryResult(ctxModule, ctxTarget, addresses, result))
    .catch(err => logEmailDeliveryResult(ctxModule, ctxTarget, addresses, null, err.message));
}

// Ghi dòng Nhật ký hệ thống XÁC NHẬN kết quả gửi email THẬT — dựa trên phản hồi thật của backend
// (đã liên hệ máy chủ SMTP đã cấu hình), không phải giả định lúc thao tác. Bao gồm rõ máy chủ
// host:port đã dùng và tách riêng người nhận thành công/thất bại, để kiểm tra/xác minh được trong
// module Log thay vì chỉ biết hệ thống "đã thử gửi".
function logEmailDeliveryResult(module, targetCode, addresses, result, networkError) {
  if (networkError) {
    logSystemAction(module, 'EMAIL_DELIVERY_FAILED',
      `Không liên hệ được backend để gửi email thật (${networkError}). Người nhận dự kiến: ${addresses.join(', ')}`,
      'WARNING', targetCode);
    return;
  }
  if (!result) return;
  if (result.simulated) {
    logSystemAction(module, 'EMAIL_SIMULATED',
      `Chưa nhập SMTP Server ở màn Quản trị > Cấu Hình Email (hoặc đang Tắt gửi mail) — email chỉ mô phỏng, KHÔNG gửi thật tới: ${addresses.join(', ')}`,
      'WARNING', targetCode);
    return;
  }
  const host = result.host ? `${result.host}:${result.port || ''}` : '(không rõ máy chủ)';
  const sent = result.sent || [];
  const failed = result.failed || [];
  if (failed.length) {
    logSystemAction(module, 'EMAIL_DELIVERY_FAILED',
      `Máy chủ SMTP ${host} từ chối/lỗi gửi tới: ${failed.join(', ')}` + (sent.length ? `; đã xác nhận gửi thành công tới: ${sent.join(', ')}` : ''),
      'WARNING', targetCode);
  } else if (sent.length) {
    logSystemAction(module, 'EMAIL_DELIVERY_CONFIRMED',
      `Máy chủ SMTP ${host} đã xác nhận nhận email thành công, gửi tới: ${sent.join(', ')}`,
      'SUCCESS', targetCode);
  }
}

// --- EMAIL SIMULATOR ---
function sendNotificationEmail(recipientEmail, recipientName, subject, messageBody) {
  if (!DB.emailConfig.enabled) return;
  if (!recipientEmail) return;
  console.log(`[DMS EMAIL SIMULATOR] To: ${recipientName} <${recipientEmail}> | Subject: ${subject}`);
  dispatchRealEmail([recipientEmail], subject, messageBody || subject, { module: 'EMAIL', targetCode: recipientEmail });
  logSystemAction('EMAIL', 'SEND_EMAIL_SUCCESS', `Đã gửi email tự động tới [${recipientName} - ${recipientEmail}] với chủ đề: "${subject}"`, 'SUCCESS', recipientEmail);
}

// Gửi + ghi log thông báo email cho 1 nhóm người nhận (theo username hệ thống) — tra email từ
// DB.users rồi giao cho notifyRecipientsByEmail() xử lý gửi + ghi log dùng chung.
function notifyUsersByEmail(module, actionType, targetCode, usernames, subject, bodyText) {
  const recipients = [];
  for (const uname of new Set((usernames || []).filter(Boolean))) {
    const u = DB.users.find(x => x.username === uname);
    if (u && u.email) recipients.push(u);
  }
  notifyRecipientsByEmail(module, actionType, targetCode, recipients, subject, bodyText);
}

// Gửi + ghi log thông báo email cho 1 nhóm người nhận đã có sẵn {name, email} (không cần tra theo
// username hệ thống — dùng cho thành phần tham dự biên bản họp nhập tay, có thể không phải user hệ
// thống). Gộp thành 1 dòng Nhật ký hệ thống duy nhất theo đúng phân hệ nghiệp vụ gọi tới
// (DOC/SUBMISSION/CAR/OFFICE/MEETING/MINUTES/TASK) — để lọc được theo "Lọc Theo Phân Hệ" ở module
// Log, nhất quán với cách jobs/contractExpiryReminder.js đã làm ở phía server cho nhắc hạn hợp đồng.
function notifyRecipientsByEmail(module, actionType, targetCode, recipients, subject, bodyText) {
  const valid = (recipients || []).filter(r => r && r.email);
  valid.forEach(r => {
    console.log(`[DMS EMAIL SIMULATOR] To: ${r.name || r.email} <${r.email}> | Subject: ${subject}\n  ${bodyText}`);
  });
  dispatchRealEmail(valid, subject, bodyText, { module, targetCode });
  logSystemAction(
    module, actionType,
    valid.length
      ? `${bodyText} (Đã gửi tới: ${valid.map(r => `${r.name || r.email} <${r.email}>`).join(', ')})`
      : `${bodyText} (Không có người nhận hợp lệ — thiếu email hoặc chưa cấu hình người duyệt)`,
    valid.length ? 'SUCCESS' : 'WARNING',
    targetCode
  );
}

// ==========================================
// MODAL XÁC NHẬN DÙNG CHUNG (Đồng Ý/Hủy) — khác hẳn withApprovalAuth() bên dưới (đó là xác THỰC lại
// mật khẩu/OTP, còn đây chỉ là hỏi "bạn có chắc chắn không" trước khi thực hiện 1 hành động, không
// yêu cầu nhập gì thêm). Dùng cho: trình văn bản, phê duyệt, từ chối/hủy, yêu cầu bổ sung ở Văn bản
// trình/Đăng ký xe/Đề xuất văn phòng — xem các lời gọi showConfirmModal() ở từng module.
// ==========================================
let _pendingConfirmAction = null;

function showConfirmModal({ title, bodyHTML, onConfirm, confirmLabel }) {
  document.getElementById('genericConfirmTitle').innerText = title || 'Xác nhận';
  document.getElementById('genericConfirmBody').innerHTML = bodyHTML || '';
  document.getElementById('genericConfirmOkBtn').innerText = confirmLabel || 'Đồng Ý';
  _pendingConfirmAction = typeof onConfirm === 'function' ? onConfirm : null;
  document.getElementById('genericConfirmModal').classList.remove('hidden');
}

function closeGenericConfirmModal() {
  document.getElementById('genericConfirmModal').classList.add('hidden');
  _pendingConfirmAction = null;
}

// Tách hành động ra khỏi biến toàn cục TRƯỚC khi đóng modal/gọi hành động — tránh trường hợp hành
// động (vd mở tiếp modal xác thực mật khẩu/OTP của withApprovalAuth) vô tình bị closeGenericConfirmModal()
// gọi sau đó xoá mất state đang cần dùng.
function runConfirmedAction() {
  const fn = _pendingConfirmAction;
  document.getElementById('genericConfirmModal').classList.add('hidden');
  _pendingConfirmAction = null;
  if (fn) fn();
}

// ============================================================
// "BỔ SUNG" — người duyệt bước hiện tại trả hồ sơ về NHÁP (REQUEST_CHANGES, xem lib/workflowEngine.js
// MODULE_CONFIGS/routes/workflow.js), người trình SỬA LẠI TOÀN BỘ nội dung (kể cả tệp đính kèm, nếu
// module có) rồi "Lưu & Gửi Lại" — vào lại hàng chờ duyệt từ bước 1 (xem lib/recordActions.js
// editDocDraft()/submitDocDraft() và 3 cặp tương ứng cho carRegs/officeReqs/submissions).
// requestWorkflowChangesAction(): phía NGƯỜI DUYỆT, dùng chung cho mọi module không có sẵn 1 modal xử
// lý/comment box riêng (Tài Liệu, Hợp Đồng, Quản Lý HĐ) — cùng khuôn prompt() đã dùng cho rejectDoc()/
// rejectContractAction() ở trên. Đăng Ký Xe/Mua Bán-Sửa Chữa-Đầu Tư/Văn Bản Trình đã có sẵn modal xử lý
// riêng (txtCarComment/txtOfficeComment/txtSubmissionComment) nên nút "Bổ Sung" của 3 module đó gọi
// thẳng qua confirmProcessCarReg('REQUEST_CHANGES')/... (xem từng module) thay vì hàm này.
async function requestWorkflowChangesAction(moduleKey, id, list, renderFnName, recordLabel) {
  const item = list.find(x => x.id === id);
  if (!item) return;
  const reason = prompt(`Nhập lý do cần bổ sung — hồ sơ sẽ được trả về NHÁP để ${recordLabel || 'người trình'} sửa lại toàn bộ nội dung rồi gửi lại:`);
  if (reason === null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do cần bổ sung!');
  showConfirmModal({
    title: '🔄 Yêu Cầu Bổ Sung',
    bodyHTML: `<p>Trả hồ sơ <b>${escapeHtml(item.code || '')}</b> về NHÁP để sửa lại toàn bộ nội dung rồi gửi lại?</p><p class="mt-2 italic text-gray-600">Lý do: "${escapeHtml(reason.trim())}"</p>`,
    confirmLabel: 'Yêu Cầu Bổ Sung',
    onConfirm: async () => {
      let result;
      try {
        result = await callWorkflowAction(moduleKey, id, 'request-changes', { comment: reason.trim() });
      } catch (e) { return alert('⛔ ' + e.message); }
      const idx = list.findIndex(x => x.id === id);
      if (idx !== -1) list[idx] = result.item;
      logSystemAction(moduleKey.toUpperCase(), 'REQUEST_CHANGES', `Yêu cầu bổ sung hồ sơ [${result.item.code || id}]: ${reason.trim()}`, 'SUCCESS', String(result.item.code || id));
      alert('✅ Đã yêu cầu bổ sung — hồ sơ đã chuyển về NHÁP để sửa lại!');
      const renderFn = window[renderFnName];
      if (typeof renderFn === 'function') renderFn();
      refreshApprovalSurfaces();
    }
  });
}

// openBosungEditModal()/confirmBosungResubmit(): phía NGƯỜI TRÌNH — modal sửa-toàn-bộ-nội-dung dùng
// chung cho 4 module (Tài Liệu/Đăng Ký Xe/Mua Bán-Sửa Chữa-Đầu Tư/Văn Bản Trình) vốn không có khái
// niệm NHÁP trước khi có "Bổ Sung" nên không có sẵn form tạo-mới nào tái dùng được nguyên vẹn cho việc
// sửa (dept/cat/mode-động của form Tài Liệu, vd, gắn chặt với luồng "phiên bản mới" — không hợp để tái
// dùng cho trường hợp này). VPP/Ngân Sách/Hợp Đồng đã tự có form/luồng sửa nháp riêng, không cần modal
// này (xem editVppRegDraft()/openEditContract() ở mỗi module).
let bosungEditTarget = null; // { module, id }

const BOSUNG_MODULE_META = {
  docs: { list: () => DB.docs, title: '📂 Bổ Sung Tài Liệu', renderFn: 'renderDocs' },
  carRegs: { list: () => DB.carRegs, title: '🚗 Bổ Sung Phiếu Đăng Ký Xe', renderFn: 'renderCarRegs' },
  officeReqs: { list: () => DB.officeReqs, title: '🛒 Bổ Sung Đề Xuất Văn Phòng', renderFn: 'renderOfficeReqs' },
  submissions: { list: () => DB.submissions, title: '📜 Bổ Sung Văn Bản Trình', renderFn: 'renderSubmissionReqs' },
  operationOrders: { list: () => DB.operationOrders, title: '📦 Bổ Sung Đơn Hàng', renderFn: 'renderOperationOrderList' },
  operationStoreOpenings: { list: () => DB.operationStoreOpenings, title: '🏬 Bổ Sung Đề Xuất Mở Mới Siêu Thị', renderFn: 'renderOperationStoreOpeningList' },
  operationRepairs: { list: () => DB.operationRepairs, title: '🔧 Bổ Sung Đề Xuất Sửa Chữa Siêu Thị', renderFn: 'renderOperationRepairList' }
};

function openBosungEditModal(moduleKey, id) {
  const meta = BOSUNG_MODULE_META[moduleKey];
  const item = meta.list().find(x => x.id === id);
  if (!item) return;
  // Mục C: nhánh operationStoreOpenings/operationRepairs bên dưới có picker "Người Phụ Trách" dùng
  // chung datalist sdd* — nạp nguồn gợi ý trước (vô hại/rẻ với các moduleKey khác không dùng tới).
  populateSystemUsersDatalist();
  bosungEditTarget = { module: moduleKey, id };
  document.getElementById('bosungEditTitle').innerText = `${meta.title}: ${item.code || ''}`;
  // FILE_PROPOSAL_DECLINED: người trình từ chối đề xuất thay thế tệp của Trợ Lý/Thư Ký (xem
  // openTroLyThuKyBoSungChoice()/resolveFileProposal() bên dưới) — cũng đưa hồ sơ về NHÁP y hệt
  // REQUEST_CHANGES nên gộp chung tìm lý do gần nhất để hiển thị ở đây.
  const lastReq = (item.history || []).slice().reverse().find(h => h.action === 'REQUEST_CHANGES' || h.action === 'FILE_PROPOSAL_DECLINED');
  document.getElementById('bosungEditReasonNote').innerHTML = lastReq
    ? `⚠️ <b>Người duyệt yêu cầu bổ sung:</b> ${escapeHtml(lastReq.comment || '')}`
    : '⚠️ Hồ sơ đang ở trạng thái cần bổ sung — vui lòng sửa lại nội dung rồi gửi lại.';

  const deptOptionsHTML = (DB.depts || []).map(d => `<option value="${escapeHtml(d)}" ${d === item.dept ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');

  let bodyHTML = '';
  if (moduleKey === 'docs') {
    const catOptionsHTML = (DB.cats || []).map(c => `<option value="${escapeHtml(c)}" ${c === item.cat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
    bodyHTML = `
      <div><label class="block font-semibold mb-1">Tiêu đề</label><input id="bsTitle" class="w-full border p-2 rounded" value="${escapeHtml(item.title || '')}"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block font-semibold mb-1">Phòng ban trình</label><select id="bsDept" class="w-full border p-2 rounded bg-white">${deptOptionsHTML}</select></div>
        <div><label class="block font-semibold mb-1">Phân loại</label><select id="bsCat" class="w-full border p-2 rounded bg-white">${catOptionsHTML}</select></div>
      </div>
      <div><label class="block font-semibold mb-1">Phiên bản</label><input id="bsVer" class="w-full border p-2 rounded" value="${escapeHtml(item.ver || '')}"></div>
      <div><label class="block font-semibold mb-1">Trích lục / Tóm tắt</label><textarea id="bsSummary" class="w-full border p-2 rounded h-20">${escapeHtml(item.summary || '')}</textarea></div>
      <div>
        <label class="block font-semibold mb-1">Thay thế tệp đính kèm (bỏ trống = giữ tệp hiện tại: ${escapeHtml(item.fileName || 'chưa có')})</label>
        <input type="file" id="bsFile" accept=".pdf,.docx,.xlsx" class="w-full border p-1 bg-white rounded">
      </div>
    `;
  } else if (moduleKey === 'carRegs') {
    const typeOptionsHTML = (DB.carTypes || []).map(t => `<option value="${escapeHtml(t)}" ${t === item.type ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
    bodyHTML = `
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block font-semibold mb-1">Phòng ban</label><select id="bsDept" class="w-full border p-2 rounded bg-white">${deptOptionsHTML}</select></div>
        <div><label class="block font-semibold mb-1">Loại xe</label><select id="bsType" class="w-full border p-2 rounded bg-white">${typeOptionsHTML}</select></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block font-semibold mb-1">Bắt đầu</label><input type="datetime-local" id="bsStartTime" class="w-full border p-2 rounded" value="${escapeHtml(item.startTime || '')}"></div>
        <div><label class="block font-semibold mb-1">Kết thúc</label><input type="datetime-local" id="bsEndTime" class="w-full border p-2 rounded" value="${escapeHtml(item.endTime || '')}"></div>
      </div>
      <div><label class="block font-semibold mb-1">Số người sử dụng</label><input id="bsPassengers" class="w-full border p-2 rounded" value="${escapeHtml(item.passengers || '')}"></div>
      <div><label class="block font-semibold mb-1">Người sử dụng trực tiếp</label><input id="bsDirectUser" class="w-full border p-2 rounded" value="${escapeHtml(item.directUser || '')}"></div>
      <div><label class="block font-semibold mb-1">Mục đích sử dụng</label><input id="bsPurpose" class="w-full border p-2 rounded" value="${escapeHtml(item.purpose || '')}"></div>
      <div><label class="block font-semibold mb-1">Số KM dự kiến</label><input type="number" id="bsKm" class="w-full border p-2 rounded" value="${item.km || 0}"></div>
      <div><label class="block font-semibold mb-1">Nội dung chi tiết</label><textarea id="bsReason" class="w-full border p-2 rounded h-20">${escapeHtml(item.reason || '')}</textarea></div>
    `;
  } else if (moduleKey === 'officeReqs') {
    bodyHTML = `
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block font-semibold mb-1">Phòng ban</label><select id="bsDept" class="w-full border p-2 rounded bg-white">${deptOptionsHTML}</select></div>
        <div><label class="block font-semibold mb-1">Tiêu đề đề xuất</label><input id="bsTitle" class="w-full border p-2 rounded" value="${escapeHtml(item.title || '')}"></div>
      </div>
      ${item.subType === 'MUA_BAN'
        ? `<p class="text-gray-500 italic">Danh sách hạng mục (Mua Sắm) giữ nguyên như đã trình — chỉ sửa được tiêu đề/lý do ở đây trong bản Bổ Sung này. Cần sửa hạng mục, vui lòng liên hệ Quản Trị Viên.</p>`
        : `<div class="grid grid-cols-2 gap-3">
            <div><label class="block font-semibold mb-1">Số lượng</label><input id="bsQty" class="w-full border p-2 rounded" value="${escapeHtml(item.qty || '')}"></div>
            <div><label class="block font-semibold mb-1">Dự toán / Chi phí</label><input type="number" id="bsAmount" class="w-full border p-2 rounded" value="${item.amount || 0}"></div>
          </div>
          <div><label class="block font-semibold mb-1">Nhà cung cấp</label><input id="bsSupplier" class="w-full border p-2 rounded" value="${escapeHtml(item.supplier || '')}"></div>`}
      <div><label class="block font-semibold mb-1">Lý do / Nội dung</label><textarea id="bsReason" class="w-full border p-2 rounded h-20">${escapeHtml(item.reason || '')}</textarea></div>
    `;
  } else if (moduleKey === 'submissions') {
    const typeOptionsHTML = (DB.submissionTypes || []).map(t => `<option value="${escapeHtml(t.label)}" ${t.label === item.type ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('');
    bodyHTML = `
      <div><label class="block font-semibold mb-1">Tiêu đề</label><input id="bsTitle" class="w-full border p-2 rounded" value="${escapeHtml(item.title || '')}"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block font-semibold mb-1">Phòng ban trình</label><select id="bsDept" class="w-full border p-2 rounded bg-white">${deptOptionsHTML}</select></div>
        <div><label class="block font-semibold mb-1">Loại tờ trình</label><select id="bsType" class="w-full border p-2 rounded bg-white">${typeOptionsHTML}</select></div>
      </div>
      <div><label class="block font-semibold mb-1">Nội dung</label><textarea id="bsContent" class="w-full border p-2 rounded h-24">${escapeHtml(item.content || '')}</textarea></div>
      <div>
        <label class="block font-semibold mb-1">Thay thế tệp chính (bỏ trống = giữ tệp hiện tại: ${escapeHtml(item.fileName || 'chưa có')})</label>
        <input type="file" id="bsFile" accept=".pdf,.docx,.xlsx" class="w-full border p-1 bg-white rounded">
      </div>
      <p class="text-gray-500 italic">Đổi loại tờ trình/phòng ban sẽ tự tính lại quy trình duyệt tương ứng. Các lớp phê duyệt bổ sung (Đồng trình/Xin ý kiến...) giữ nguyên như đã chọn lúc trình.</p>
    `;
  } else if (moduleKey === 'operationOrders') {
    bodyHTML = `
      <div><label class="block font-semibold mb-1">Tiêu đề đơn hàng</label><input id="bsTitle" class="w-full border p-2 rounded" value="${escapeHtml(item.title || '')}"></div>
      <div><label class="block font-semibold mb-1">Nhà cung cấp</label><input id="bsSupplier" class="w-full border p-2 rounded" value="${escapeHtml(item.supplier || '')}"></div>
      <p class="text-gray-500 italic">Danh sách hạng mục giữ nguyên như đã trình — chỉ sửa được tiêu đề/nhà cung cấp/ghi chú ở đây. Cần sửa hạng mục, vui lòng liên hệ Quản Trị Viên.</p>
      <div><label class="block font-semibold mb-1">Ghi chú</label><textarea id="bsNote" class="w-full border p-2 rounded h-20">${escapeHtml(item.note || '')}</textarea></div>
    `;
  } else if (moduleKey === 'operationStoreOpenings') {
    bodyHTML = `
      <div><label class="block font-semibold mb-1">Tên siêu thị dự kiến</label><input id="bsStoreName" class="w-full border p-2 rounded" value="${escapeHtml(item.storeName || '')}"></div>
      <div><label class="block font-semibold mb-1">Địa điểm dự kiến</label><input id="bsAddress" class="w-full border p-2 rounded" value="${escapeHtml(item.address || '')}"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block font-semibold mb-1">Diện tích dự kiến (m²)</label><input type="number" id="bsArea" class="w-full border p-2 rounded" value="${item.area || 0}"></div>
        <div><label class="block font-semibold mb-1">Chi Phí Phê Duyệt</label><input type="number" id="bsBudget" class="w-full border p-2 rounded" value="${item.estimatedBudget || 0}"></div>
        <div><label class="block font-semibold mb-1">Ngân Sách Phê Duyệt (Danh Mục Đầu Tư)</label><input type="number" id="bsApprovedBudget" class="w-full border p-2 rounded" value="${item.approvedBudget || 0}"></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block font-semibold mb-1">Ngày dự kiến khai trương</label><input type="date" id="bsOpenDate" class="w-full border p-2 rounded" value="${escapeHtml((item.expectedOpenDate || '').slice(0, 10))}"></div>
        <div class="relative"><label class="block font-semibold mb-1">Người phụ trách</label><input id="bsPersonInChargeInput" data-sdd-list="systemUsersDatalist" autocomplete="off" data-op-change="resolveBsPersonInChargeInput" data-arg-value="0" placeholder="Gõ tên hoặc tài khoản..." class="w-full border p-2 rounded" value="${item.personInChargeName ? escapeHtml(`${item.personInChargeName} — (${item.personInCharge})`) : escapeHtml(item.personInCharge || '')}"><input type="hidden" id="bsPersonInChargeUsername" value="${escapeHtml(item.personInChargeName ? (item.personInCharge || '') : '')}"></div>
      </div>
      <div><label class="block font-semibold mb-1">Ghi chú</label><textarea id="bsNote" class="w-full border p-2 rounded h-20">${escapeHtml(item.note || '')}</textarea></div>
    `;
  } else if (moduleKey === 'operationRepairs') {
    bodyHTML = `
      <div><label class="block font-semibold mb-1">Siêu thị cần sửa chữa</label><input id="bsStoreName" class="w-full border p-2 rounded" value="${escapeHtml(item.storeName || '')}"></div>
      <div><label class="block font-semibold mb-1">Nội dung sửa chữa</label><input id="bsTitle" class="w-full border p-2 rounded" value="${escapeHtml(item.title || '')}"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block font-semibold mb-1">Chi Phí Phê Duyệt</label><input type="number" id="bsAmount" class="w-full border p-2 rounded" value="${item.amount || 0}"></div>
        <div><label class="block font-semibold mb-1">Ngân Sách Phê Duyệt (Danh Mục Đầu Tư)</label><input type="number" id="bsApprovedBudget" class="w-full border p-2 rounded" value="${item.approvedBudget || 0}"></div>
        <div><label class="block font-semibold mb-1">Nhà cung cấp</label><input id="bsSupplier" class="w-full border p-2 rounded" value="${escapeHtml(item.supplier || '')}"></div>
      </div>
      <div class="relative"><label class="block font-semibold mb-1">Người phụ trách</label><input id="bsPersonInChargeInput" data-sdd-list="systemUsersDatalist" autocomplete="off" data-op-change="resolveBsPersonInChargeInput" data-arg-value="0" placeholder="Gõ tên hoặc tài khoản..." class="w-full border p-2 rounded" value="${item.personInChargeName ? escapeHtml(`${item.personInChargeName} — (${item.personInCharge})`) : escapeHtml(item.personInCharge || '')}"><input type="hidden" id="bsPersonInChargeUsername" value="${escapeHtml(item.personInChargeName ? (item.personInCharge || '') : '')}"></div>
      <div><label class="block font-semibold mb-1">Mô tả chi tiết</label><textarea id="bsDescription" class="w-full border p-2 rounded h-20">${escapeHtml(item.description || '')}</textarea></div>
    `;
  }
  document.getElementById('bosungEditBody').innerHTML = bodyHTML;
  document.getElementById('bosungEditModal').classList.remove('hidden');
}

// Người Phụ Trách trong modal "Bổ Sung" — modal này dùng chung cho nhiều module (docs/carRegs/
// officeReqs/submissions/operationOrders/operationStoreOpenings/operationRepairs), KHÔNG nằm trong
// bindOperationDelegation() (chỉ bọc vanHanhSection/các modal con của Vận Hành). Dùng data-op-change
// qua bindCspDelegation('bosungEditModal') (đăng ký cạnh các bindCspDelegation() khác, gần cuối file)
// — CSP scriptSrcAttr đã khoá 'none' toàn hệ thống nên KHÔNG được dùng onchange= inline (đã thử, bị
// trình duyệt chặn ngay — phát hiện qua demo Playwright thật). Cùng khuôn resolveVsoPersonInChargeInput().
function resolveBsPersonInChargeInput(rawValue) {
  const m = rawValue.match(/^(.*) — .*\(([^()]+)\)$/);
  document.getElementById('bsPersonInChargeUsername').value = m ? m[2].trim() : '';
}

function closeBosungEditModal() {
  document.getElementById('bosungEditModal').classList.add('hidden');
  bosungEditTarget = null;
}

async function confirmBosungResubmit() {
  if (!bosungEditTarget) return;
  const { module: moduleKey, id } = bosungEditTarget;
  const meta = BOSUNG_MODULE_META[moduleKey];
  const item = meta.list().find(x => x.id === id);
  if (!item) return;

  let payload = {};
  try {
    if (moduleKey === 'docs') {
      const fileInput = document.getElementById('bsFile');
      payload = {
        title: document.getElementById('bsTitle').value.trim(),
        dept: document.getElementById('bsDept').value,
        cat: document.getElementById('bsCat').value,
        ver: document.getElementById('bsVer').value.trim(),
        summary: document.getElementById('bsSummary').value.trim()
      };
      if (fileInput.files && fileInput.files[0]) {
        const uploaded = await uploadFileToServer(fileInput.files[0], 'doc');
        payload.fileUrl = uploaded.fileUrl; payload.fileName = uploaded.fileName; payload.fileType = uploaded.fileType;
      }
    } else if (moduleKey === 'carRegs') {
      payload = {
        dept: document.getElementById('bsDept').value,
        type: document.getElementById('bsType').value,
        startTime: document.getElementById('bsStartTime').value,
        endTime: document.getElementById('bsEndTime').value,
        passengers: document.getElementById('bsPassengers').value.trim(),
        directUser: document.getElementById('bsDirectUser').value.trim(),
        purpose: document.getElementById('bsPurpose').value.trim(),
        km: parseFloat(document.getElementById('bsKm').value) || 0,
        reason: document.getElementById('bsReason').value.trim()
      };
    } else if (moduleKey === 'officeReqs') {
      payload = {
        dept: document.getElementById('bsDept').value,
        title: document.getElementById('bsTitle').value.trim(),
        reason: document.getElementById('bsReason').value.trim()
      };
      if (item.subType !== 'MUA_BAN') {
        payload.qty = document.getElementById('bsQty').value.trim();
        payload.amount = Number(document.getElementById('bsAmount').value) || 0;
        payload.supplier = document.getElementById('bsSupplier').value.trim();
      }
    } else if (moduleKey === 'submissions') {
      const fileInput = document.getElementById('bsFile');
      payload = {
        title: document.getElementById('bsTitle').value.trim(),
        dept: document.getElementById('bsDept').value,
        type: document.getElementById('bsType').value,
        content: document.getElementById('bsContent').value.trim()
      };
      if (fileInput.files && fileInput.files[0]) {
        const uploaded = await uploadFileToServer(fileInput.files[0], 'submission');
        payload.fileUrl = uploaded.fileUrl; payload.fileName = uploaded.fileName; payload.fileType = uploaded.fileType;
      }
    } else if (moduleKey === 'operationOrders') {
      payload = {
        title: document.getElementById('bsTitle').value.trim(),
        supplier: document.getElementById('bsSupplier').value.trim(),
        note: document.getElementById('bsNote').value.trim()
      };
    } else if (moduleKey === 'operationStoreOpenings') {
      payload = {
        storeName: document.getElementById('bsStoreName').value.trim(),
        address: document.getElementById('bsAddress').value.trim(),
        area: Number(document.getElementById('bsArea').value) || 0,
        estimatedBudget: Number(document.getElementById('bsBudget').value) || 0,
        approvedBudget: Number(document.getElementById('bsApprovedBudget').value) || 0,
        expectedOpenDate: document.getElementById('bsOpenDate').value,
        personInCharge: document.getElementById('bsPersonInChargeUsername').value || '',
        note: document.getElementById('bsNote').value.trim()
      };
    } else if (moduleKey === 'operationRepairs') {
      payload = {
        storeName: document.getElementById('bsStoreName').value.trim(),
        title: document.getElementById('bsTitle').value.trim(),
        amount: Number(document.getElementById('bsAmount').value) || 0,
        approvedBudget: Number(document.getElementById('bsApprovedBudget').value) || 0,
        supplier: document.getElementById('bsSupplier').value.trim(),
        personInCharge: document.getElementById('bsPersonInChargeUsername').value || '',
        description: document.getElementById('bsDescription').value.trim()
      };
    }
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  let updated;
  try {
    await callRecordAction(moduleKey, id, 'update', payload);
    const submitResult = await callRecordAction(moduleKey, id, 'submit', {});
    updated = submitResult.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const list = meta.list();
  const idx = list.findIndex(x => x.id === id);
  if (idx !== -1) list[idx] = updated;

  logSystemAction(moduleKey.toUpperCase(), 'RESUBMIT_AFTER_BOSUNG', `Sửa & gửi lại hồ sơ [${updated.code}] sau khi được yêu cầu bổ sung`, 'SUCCESS', updated.code);
  alert('✅ Đã lưu thay đổi và gửi lại — hồ sơ đã vào lại hàng chờ duyệt từ bước 1!');
  closeBosungEditModal();
  const renderFn = window[meta.renderFn];
  if (typeof renderFn === 'function') renderFn();
  refreshApprovalSurfaces();
}

// ==========================================
// XÓA "QUYỀN TỐI CAO" — chỉ Quản Trị Viên (admin), dùng chung cho các module trước đây KHÔNG có chức
// năng xóa nào (Tài liệu/Văn bản trình/Hợp đồng/Mua Bán-Sửa Chữa-Đầu Tư/Đăng Ký Xe — xem
// deleteDocAction/deleteSubmissionAction/deleteContractAction/deleteOfficeReqAction/deleteCarRegAction
// bên dưới mỗi module). Người dùng thường KHÔNG còn xóa được ở bất kỳ module nghiệp vụ nào (Biên bản
// họp/Thanh toán cũng đã khóa riêng — xem canDeleteMeetingMinutesRecord()/assertCanDeletePaymentRequest()).
// ==========================================
function deleteRecordAdminOnly(collection, id, label, onDeleted) {
  if (!currentUser.perms?.admin) return alert('⛔ Chỉ Quản Trị Viên mới có quyền xóa dữ liệu ở module này!');
  showConfirmModal({
    title: 'Xóa dữ liệu',
    bodyHTML: `Bạn có chắc chắn muốn xóa <b>${escapeHtml(label)}</b>? Hành động này không thể hoàn tác.`,
    confirmLabel: 'Xóa',
    onConfirm: async () => {
      try {
        await callRecordAction(collection, id, 'delete', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      onDeleted();
    }
  });
}

// ==========================================
// XÁC THỰC BỔ SUNG KHI DUYỆT (nhập lại mật khẩu / OTP email) — perms.approverAuthLevel, cấu hình ở
// khối "9. Người Duyệt" trong Quản trị. Chỉ áp dụng cho hành động DUYỆT (không phải Từ chối/Hủy) ở
// 3 module Văn bản trình/Đăng ký xe/Văn phòng — xem lời gọi withApprovalAuth() ở mỗi module.
// ==========================================
let pendingApprovalAction = null;

// Gọi hàm actionFn() ngay nếu người dùng không cấu hình xác thực bổ sung (mặc định), ngược lại mở
// modal yêu cầu nhập mật khẩu/OTP trước, chỉ gọi actionFn() sau khi xác thực đúng.
function withApprovalAuth(actionFn) {
  const level = currentUser.perms?.approverAuthLevel || 'NONE';
  if (level === 'NONE') { actionFn(); return; }
  // WEBAUTHN không dùng modal nhập liệu như 3 mức kia — hộp thoại vân tay/Face ID CỦA HỆ ĐIỀU HÀNH
  // chính là bước xác nhận, xong ngay là chạy actionFn() luôn (xem runWebauthnApprovalAuth() bên dưới).
  if (level === 'WEBAUTHN') { runWebauthnApprovalAuth(actionFn); return; }

  pendingApprovalAction = actionFn;
  document.getElementById('approvalAuthPasswordGroup').classList.toggle('hidden', level !== 'PASSWORD');
  document.getElementById('approvalAuthOtpGroup').classList.toggle('hidden', level !== 'OTP_EMAIL');
  document.getElementById('approvalAuthPinGroup').classList.toggle('hidden', level !== 'PIN');
  document.getElementById('approvalAuthPasswordInput').value = '';
  document.getElementById('approvalAuthOtpInput').value = '';
  document.getElementById('approvalAuthPinInput').value = '';
  document.getElementById('approvalAuthModal').classList.remove('hidden');

  if (level === 'OTP_EMAIL') sendApprovalOtp(false);
}

// Yêu cầu SERVER sinh mã OTP mới + gửi email thật (POST /api/auth/request-approval-otp) — trước đây
// mã OTP được sinh/so sánh hoàn toàn ở JS trình duyệt (không có giá trị bảo mật thật), giờ server tự
// giữ mã + cấp "phiếu Duyệt" khi xác thực đúng (xem lib/approvalAuth.js).
async function sendApprovalOtp(isResend) {
  try {
    const res = await fetch('/api/auth/request-approval-otp', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      alert(`⛔ Không thể gửi mã OTP: ${body.error || 'Lỗi không xác định'}`);
      return;
    }
  } catch (e) {
    return alert('⛔ Không thể kết nối tới máy chủ để gửi mã OTP: ' + e.message);
  }
  logSystemAction(
    'AUTH', 'SEND_APPROVAL_OTP',
    `${isResend ? 'Gửi lại' : 'Gửi'} mã OTP xác thực phê duyệt cho ${currentUser.name}` + (currentUser.email ? ` <${currentUser.email}>` : ' (không có email)'),
    currentUser.email ? 'SUCCESS' : 'WARNING',
    currentUser.username
  );
}

function closeApprovalAuthModal() {
  document.getElementById('approvalAuthModal').classList.add('hidden');
  pendingApprovalAction = null;
}

// Nhánh WEBAUTHN của withApprovalAuth() ở trên — xác thực bằng vân tay/Face ID rồi cấp "phiếu Duyệt"
// qua POST /api/auth/webauthn/approval-verify (issueApprovalGrant() phía server, xem lib/approvalAuth.js
// + lib/webauthn.js) trước khi chạy actionFn(), cùng khuôn với confirmApprovalAuth() cho 3 mức kia.
async function runWebauthnApprovalAuth(actionFn) {
  try {
    await loadVendorScript('/vendor/simplewebauthn/browser.min.js');

    const optRes = await fetch('/api/auth/webauthn/approval-options', { method: 'POST' });
    if (!optRes.ok) {
      const body = await optRes.json().catch(() => ({}));
      return alert(`⛔ ${body.error || 'Không thể khởi tạo xác thực vân tay'}`);
    }
    const optionsJSON = await optRes.json();
    if (!optionsJSON.allowCredentials || !optionsJSON.allowCredentials.length) {
      return alert('⛔ Bạn chưa đăng ký thiết bị vân tay/Face ID nào — vào "⚙️ Cá Nhân Hóa" để đăng ký trước khi Duyệt.');
    }

    let assertion;
    try {
      assertion = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
    } catch (e) {
      if (e.name === 'NotAllowedError') return; // người dùng tự huỷ hộp thoại — không báo lỗi
      return alert('⛔ Không đọc được vân tay/Face ID: ' + e.message);
    }

    const verifyRes = await fetch('/api/auth/webauthn/approval-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: assertion })
    });
    const body = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok || !body.ok) {
      return alert('⛔ Xác thực vân tay không thành công, vui lòng thử lại!');
    }

    logSystemAction('AUTH', 'APPROVAL_AUTH_SUCCESS', 'Xác thực vân tay/Face ID thành công trước khi phê duyệt', 'SUCCESS', currentUser.username);
    actionFn();
  } catch (e) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }
}

async function confirmApprovalAuth() {
  const level = currentUser.perms?.approverAuthLevel || 'NONE';

  if (level === 'PASSWORD') {
    const entered = document.getElementById('approvalAuthPasswordInput').value;
    if (!entered) return alert('⛔ Vui lòng nhập mật khẩu!');
    // Xác thực LẠI mật khẩu qua server (POST /api/auth/verify-password) — trước đây so sánh thẳng
    // với currentUser.pass ở JS trình duyệt, không có giá trị bảo mật thật (sửa được bằng DevTools).
    let ok = false;
    try {
      const res = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: entered })
      });
      const body = await res.json().catch(() => ({}));
      ok = res.ok && body.ok;
    } catch (e) {
      return alert('⛔ Không thể kết nối tới máy chủ để xác thực mật khẩu: ' + e.message);
    }
    if (!ok) return alert('⛔ Mật khẩu không đúng, vui lòng thử lại!');
  } else if (level === 'OTP_EMAIL') {
    const entered = document.getElementById('approvalAuthOtpInput').value.trim();
    if (!entered) return alert('⛔ Vui lòng nhập mã OTP!');
    // Xác thực OTP qua server (POST /api/auth/verify-approval-otp) — trước đây so sánh với biến JS cục
    // bộ pendingApprovalOtpCode ở trình duyệt, không có giá trị bảo mật thật (mã cũng sinh ở client).
    let ok = false;
    try {
      const res = await fetch('/api/auth/verify-approval-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: entered })
      });
      const body = await res.json().catch(() => ({}));
      ok = res.ok && body.ok;
    } catch (e) {
      return alert('⛔ Không thể kết nối tới máy chủ để xác thực mã OTP: ' + e.message);
    }
    if (!ok) return alert('⛔ Mã OTP không đúng hoặc đã hết hạn, vui lòng thử lại!');
  } else if (level === 'PIN') {
    const entered = document.getElementById('approvalAuthPinInput').value.trim();
    if (!entered) return alert('⛔ Vui lòng nhập mã PIN!');
    // Xác thực PIN qua server (POST /api/auth/verify-pin) — cùng lý do với PASSWORD ở trên, không so
    // sánh gì ở client vì client không hề (và không nên) cầm PIN thật.
    let ok = false;
    try {
      const res = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: entered })
      });
      const body = await res.json().catch(() => ({}));
      ok = res.ok && body.ok;
    } catch (e) {
      return alert('⛔ Không thể kết nối tới máy chủ để xác thực mã PIN: ' + e.message);
    }
    if (!ok) return alert('⛔ Mã PIN không đúng, vui lòng thử lại!');
  }

  logSystemAction('AUTH', 'APPROVAL_AUTH_SUCCESS', `Xác thực ${level === 'PASSWORD' ? 'mật khẩu' : level === 'PIN' ? 'mã PIN' : 'OTP email'} thành công trước khi phê duyệt`, 'SUCCESS', currentUser.username);

  const action = pendingApprovalAction;
  closeApprovalAuthModal();
  if (action) action();
}

// Toàn bộ user có quyền phê duyệt/hủy lịch phòng họp (cờ toàn cục meetingApprove/meetingCancel,
// không gắn theo bước quy trình như 4 module kia) — dùng để xác định người nhận thông báo email.
function getMeetingApproverUsernames() {
  return DB.moduleApproverUsernames?.meetingApprove || [];
}

// Toàn bộ user có quyền duyệt bài "Góc chia sẻ" (cờ toàn công ty internalPostApprove) — dùng để xác
// định người nhận thông báo email khi có bài mới chờ duyệt.
function getInternalPostApproverUsernames() {
  return DB.moduleApproverUsernames?.internalPostApprove || [];
}

// Toàn bộ user có quyền xét duyệt "Từ chối khẩn cấp" (Phê Duyệt Giá) — dùng để xác định người nhận
// thông báo email khi có yêu cầu mới chờ xử lý, cùng khuôn getInternalPostApproverUsernames() ở trên.
function getItPriceEmergencyRejectApproverUsernames() {
  return DB.moduleApproverUsernames?.itPriceEmergencyRejectApprove || [];
}

// Parse "30, 15, 7" -> [30, 15, 7] (số nguyên không âm, loại trùng, sắp giảm dần)
function parseDaysListInput(str) {
  const days = (str || '').split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n >= 0);
  return Array.from(new Set(days)).sort((a, b) => b - a);
}

// Parse "a@x.com, b@y.com" -> ['a@x.com', 'b@y.com']
function parseEmailListInput(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Port chuẩn của từng kiểu mã hoá (xem lib/mailer.js) — dùng để tự nhảy Port khi bấm đổi nút mã hoá.
const SMTP_ENCRYPTION_STANDARD_PORTS = { NONE: 25, STARTTLS: 587, SSL: 465 };
const SMTP_STANDARD_PORTS = Object.values(SMTP_ENCRYPTION_STANDARD_PORTS);

// Bấm 1 trong 3 nút Không mã hoá/TLS/SSL: đổi trạng thái nút đang chọn + tự nhảy Port sang giá trị
// chuẩn — TRỪ KHI Port hiện tại không phải 1 trong 3 giá trị chuẩn (25/587/465), tức admin đã tự gõ 1
// port tuỳ chỉnh (vd relay nội bộ dùng port 26/2525) — không vô tình ghi đè mất giá trị đó.
function setSmtpEncryption(mode) {
  document.getElementById('cfgSmtpEncryption').value = mode;
  ['NONE', 'STARTTLS', 'SSL'].forEach(m => {
    const btn = document.getElementById(`encBtn_${m}`);
    if (m === mode) btn.className = 'px-3 py-1.5 rounded border-2 border-amber-600 bg-amber-50 font-semibold text-amber-800';
    else btn.className = 'px-3 py-1.5 rounded border font-semibold text-gray-600 hover:bg-gray-50';
  });
  const portEl = document.getElementById('cfgSmtpPort');
  const currentPort = parseInt(portEl.value, 10);
  if (SMTP_STANDARD_PORTS.includes(currentPort)) {
    portEl.value = SMTP_ENCRYPTION_STANDARD_PORTS[mode];
  }
}

function toggleSmtpAuthFields() {
  const enabled = document.getElementById('cfgSmtpAuthEnabled').checked;
  document.getElementById('cfgSmtpAuthFields').classList.toggle('hidden', !enabled);
}

// Parse "30, 15, 7" -> [30, 15, 7] (số nguyên không âm, loại trùng, sắp giảm dần)
function parseDaysListInput(str) {
  const days = (str || '').split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n >= 0);
  return Array.from(new Set(days)).sort((a, b) => b - a);
}

// Parse "a@x.com, b@y.com" -> ['a@x.com', 'b@y.com']
function parseEmailListInput(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}

function saveEmailConfig(e) {
  e.preventDefault();
  const reminderDays = parseDaysListInput(document.getElementById('cfgContractReminderDays').value);
  if (reminderDays.length === 0) {
    return alert('⛔ Vui lòng nhập ít nhất 1 mốc số ngày nhắc hết hạn hợp lệ (vd: 30, 15, 7)!');
  }
  const licenseReminderDays = parseDaysListInput(document.getElementById('cfgLicenseReminderDays').value);
  if (licenseReminderDays.length === 0) {
    return alert('⛔ Vui lòng nhập ít nhất 1 mốc số ngày nhắc hết hạn giấy phép hợp lệ (vd: 30, 15, 7)!');
  }
  const itRenewalReminderDays = parseDaysListInput(document.getElementById('cfgItRenewalReminderDays').value);
  if (itRenewalReminderDays.length === 0) {
    return alert('⛔ Vui lòng nhập ít nhất 1 mốc số ngày nhắc hết hạn dịch vụ CNTT hợp lệ (vd: 30, 15, 7)!');
  }
  const smtpAuthEnabled = document.getElementById('cfgSmtpAuthEnabled').checked;
  DB.emailConfig = {
    enabled: document.getElementById('cfgEmailEnabled').value === 'true',
    smtpHost: document.getElementById('cfgSmtpHost').value.trim(),
    smtpPort: parseInt(document.getElementById('cfgSmtpPort').value, 10) || 587,
    smtpEncryption: document.getElementById('cfgSmtpEncryption').value,
    smtpAuthEnabled,
    smtpUser: smtpAuthEnabled ? document.getElementById('cfgSmtpUser').value.trim() : '',
    // "smtpPassPlain" là field TẠM, chỉ để server đọc 1 lần rồi mã hoá lại thành "smtpPassEnc" —
    // không phải bản ghi lưu thật (xem prepareEmailConfigForSave() ở routes/data.js). Để trống ô này
    // = giữ nguyên mật khẩu đã lưu, khớp đúng quy ước "write-only" như đổi mật khẩu người dùng.
    smtpPassPlain: smtpAuthEnabled ? document.getElementById('cfgSmtpPassPlain').value : '',
    senderEmail: document.getElementById('cfgSenderEmail').value.trim(),
    contractExpiryReminderDays: reminderDays,
    contractExpiryCcEmails: parseEmailListInput(document.getElementById('cfgContractReminderCc').value),
    licenseExpiryReminderDays: licenseReminderDays,
    licenseExpiryCcEmails: parseEmailListInput(document.getElementById('cfgLicenseReminderCc').value),
    itRenewalReminderDays: itRenewalReminderDays,
    itRenewalCcEmails: parseEmailListInput(document.getElementById('cfgItRenewalReminderCc').value),
    diskSpaceAlertThresholdPercent: parseInt(document.getElementById('cfgDiskAlertThreshold').value, 10) || 85,
    diskSpaceAlertCcEmails: parseEmailListInput(document.getElementById('cfgDiskAlertCc').value)
  };
  syncStorage('emailConfig');
  document.getElementById('cfgSmtpPassPlain').value = ''; // không giữ mật khẩu vừa gõ hiển thị lại trên form
  logSystemAction('CONFIG', 'UPDATE_SMTP_CONFIG', 'Cập nhật SMTP server thành công.', 'SUCCESS', 'SMTP_CONFIG');
  alert('✅ Đã lưu cấu hình Email thành công!');
}

// Khớp ĐÚNG resolveEncryption() ở lib/mailer.js — hồ sơ cấu hình email cũ (lưu từ trước khi có trường
// smtpEncryption, xem lib/defaults.js emailConfig cũ chỉ có smtpSecure/smtpPort) không có smtpEncryption,
// trước đây form mặc định LUÔN gán STARTTLS bất kể smtpSecure/smtpPort thực tế là gì — 1 hồ sơ cũ cấu
// hình SSL cổng 465 (smtpSecure=true) mở form Sửa lên sẽ hiện SAI thành STARTTLS, admin không để ý bấm
// Lưu là ghi đè luôn mất cấu hình mã hoá đúng đang chạy thật.
function resolveEncryptionClient(emailConfig) {
  if (emailConfig?.smtpEncryption) return emailConfig.smtpEncryption;
  const { smtpSecure, smtpPort } = emailConfig || {};
  if (smtpSecure === true) return 'SSL';
  if (smtpSecure === false) return 'STARTTLS';
  return (parseInt(smtpPort, 10) || 587) === 465 ? 'SSL' : 'STARTTLS';
}

function loadEmailConfigToForm() {
  if (!DB.emailConfig) return;
  document.getElementById('cfgEmailEnabled').value = DB.emailConfig.enabled !== false ? 'true' : 'false';
  document.getElementById('cfgSmtpHost').value = DB.emailConfig.smtpHost || 'smtp.gmail.com';
  document.getElementById('cfgSmtpPort').value = DB.emailConfig.smtpPort || 587;
  setSmtpEncryption(resolveEncryptionClient(DB.emailConfig));
  document.getElementById('cfgSmtpAuthEnabled').checked = !!DB.emailConfig.smtpAuthEnabled;
  document.getElementById('cfgSmtpUser').value = DB.emailConfig.smtpUser || '';
  document.getElementById('cfgSmtpPassPlain').value = ''; // write-only — không bao giờ có giá trị thật để hiện lại
  toggleSmtpAuthFields();
  document.getElementById('cfgSenderEmail').value = DB.emailConfig.senderEmail || 'dms-noreply@company.com';
  document.getElementById('cfgContractReminderDays').value = (DB.emailConfig.contractExpiryReminderDays && DB.emailConfig.contractExpiryReminderDays.length
    ? DB.emailConfig.contractExpiryReminderDays : [30, 15, 7]).join(', ');
  document.getElementById('cfgContractReminderCc').value = (DB.emailConfig.contractExpiryCcEmails || []).join(', ');
  document.getElementById('cfgLicenseReminderDays').value = (DB.emailConfig.licenseExpiryReminderDays && DB.emailConfig.licenseExpiryReminderDays.length
    ? DB.emailConfig.licenseExpiryReminderDays : [30, 15, 7]).join(', ');
  document.getElementById('cfgLicenseReminderCc').value = (DB.emailConfig.licenseExpiryCcEmails || []).join(', ');
  document.getElementById('cfgItRenewalReminderDays').value = (DB.emailConfig.itRenewalReminderDays && DB.emailConfig.itRenewalReminderDays.length
    ? DB.emailConfig.itRenewalReminderDays : [30, 15, 7]).join(', ');
  document.getElementById('cfgItRenewalReminderCc').value = (DB.emailConfig.itRenewalCcEmails || []).join(', ');
  document.getElementById('cfgDiskAlertThreshold').value = DB.emailConfig.diskSpaceAlertThresholdPercent || 85;
  document.getElementById('cfgDiskAlertCc').value = (DB.emailConfig.diskSpaceAlertCcEmails || []).join(', ');
  document.getElementById('cfgTestEmailResult').textContent = '';
  loadSmtpAuthStatus();
  contractExpiryDeptContactsDraft = JSON.parse(JSON.stringify(DB.contractExpiryDeptContacts || {}));
  renderDeptContactsTable();
}

// Hỏi backend server đang cấu hình tài khoản/mật khẩu đăng nhập SMTP hay không (DB.emailConfig hoặc
// .env, xem lib/mailer.js hasAuthConfigured()), để hiển thị (không nhạy cảm — chỉ có/không, không lộ
// giá trị thật) cho admin biết chắc server đang chạy đúng chế độ mình định dùng.
function loadSmtpAuthStatus() {
  const el = document.getElementById('cfgSmtpAuthStatus');
  if (!el) return;
  el.className = 'text-[11px] font-semibold rounded px-2 py-1 bg-gray-100 border text-gray-500';
  el.textContent = '⏳ Đang kiểm tra trạng thái xác thực SMTP...';
  fetch('/api/send-email/status')
    .then(res => res.json())
    .then(data => {
      if (data.hasAuth) {
        el.className = 'text-[11px] font-semibold rounded px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700';
        el.textContent = '🔒 Đang cấu hình CÓ xác thực SMTP.';
      } else {
        el.className = 'text-[11px] font-semibold rounded px-2 py-1 bg-slate-50 border border-slate-200 text-slate-600';
        el.textContent = '🔓 Đang cấu hình KHÔNG xác thực (kết nối ẩn danh tới máy chủ SMTP).';
      }
    })
    .catch(() => {
      el.className = 'text-[11px] font-semibold rounded px-2 py-1 bg-red-50 border border-red-200 text-red-700';
      el.textContent = '⚠️ Không kiểm tra được trạng thái xác thực SMTP (không liên hệ được backend).';
    });
}

// "Gửi thử": dùng THẲNG các giá trị đang gõ dở trên form (chưa lưu) để xác minh cấu hình đúng trước
// khi bấm "Lưu Cấu Hình Email" — không phải lưu mù rồi tự dò log server như trước (xem routes/email.js
// POST /test). Để trống ô mật khẩu = dùng mật khẩu ĐÃ LƯU (nếu có), không phải "không mật khẩu".
async function sendTestEmail() {
  const to = document.getElementById('cfgTestEmailTo').value.trim();
  const resultEl = document.getElementById('cfgTestEmailResult');
  if (!to) { resultEl.className = 'text-[11px] font-semibold text-red-600'; resultEl.textContent = '⛔ Nhập email nhận thử trước.'; return; }

  const btn = document.getElementById('cfgTestEmailBtn');
  btn.disabled = true;
  resultEl.className = 'text-[11px] font-semibold text-gray-500';
  resultEl.textContent = '⏳ Đang gửi thử...';

  const smtpAuthEnabled = document.getElementById('cfgSmtpAuthEnabled').checked;
  try {
    const res = await fetch('/api/send-email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        host: document.getElementById('cfgSmtpHost').value.trim(),
        port: parseInt(document.getElementById('cfgSmtpPort').value, 10) || 587,
        encryption: document.getElementById('cfgSmtpEncryption').value,
        smtpAuthEnabled,
        smtpUser: smtpAuthEnabled ? document.getElementById('cfgSmtpUser').value.trim() : '',
        smtpPass: smtpAuthEnabled ? document.getElementById('cfgSmtpPassPlain').value : '',
        senderEmail: document.getElementById('cfgSenderEmail').value.trim()
      })
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      resultEl.className = 'text-[11px] font-semibold text-green-700';
      resultEl.textContent = `✅ Đã gửi thử thành công tới máy chủ SMTP ${body.host}:${body.port}!`;
    } else {
      resultEl.className = 'text-[11px] font-semibold text-red-600';
      resultEl.textContent = `⛔ ${body.error || 'Gửi thử thất bại'}`;
    }
  } catch (err) {
    resultEl.className = 'text-[11px] font-semibold text-red-600';
    resultEl.textContent = '⛔ Không thể kết nối tới máy chủ để gửi thử: ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

// --- Người phụ trách nhận thông báo hết hạn hợp đồng theo phòng ban (contractExpiryDeptContacts) ---
// Bản nháp đang sửa trong bộ nhớ trình duyệt — { [dept]: [{name, email}, ...] } — chỉ ghi thật lên
// server khi bấm "Lưu Người Phụ Trách" (collection RIÊNG với emailConfig, xem defaults.js).
let contractExpiryDeptContactsDraft = {};

function renderDeptContactsTable() {
  const tbody = document.getElementById('deptContactsTableBody');
  if (!tbody) return;
  tbody.innerHTML = (DB.depts || []).map(dept => {
    const rows = contractExpiryDeptContactsDraft[dept] || [];
    const rowsHtml = rows.map((c, idx) => `
      <div class="flex gap-1 items-center mb-1">
        <input value="${escapeHtml(c.name || '')}" placeholder="Họ tên" data-op-input="updateDeptContactField" data-arg0="${escapeHtml(dept)}" data-arg1="${idx}" data-arg2="name" data-arg-value="3" class="border p-1 rounded flex-1">
        <input value="${escapeHtml(c.email || '')}" type="email" placeholder="Email" data-op-input="updateDeptContactField" data-arg0="${escapeHtml(dept)}" data-arg1="${idx}" data-arg2="email" data-arg-value="3" class="border p-1 rounded flex-1">
        <button type="button" data-op="removeDeptContact" data-arg0="${escapeHtml(dept)}" data-arg1="${idx}" class="text-red-600 font-bold px-1.5" title="Xoá">✕</button>
      </div>
    `).join('');
    return `
      <tr class="border-b align-top">
        <td class="py-2 pr-2 font-semibold">${escapeHtml(dept)}</td>
        <td class="py-2">
          ${rowsHtml || '<p class="text-gray-400 italic text-[11px] mb-1">Chưa có người phụ trách riêng</p>'}
          <button type="button" data-op="addDeptContact" data-arg0="${escapeHtml(dept)}" class="text-amber-700 font-semibold text-[11px]">+ Thêm người</button>
        </td>
      </tr>
    `;
  }).join('');
}

function addDeptContact(dept) {
  if (!contractExpiryDeptContactsDraft[dept]) contractExpiryDeptContactsDraft[dept] = [];
  contractExpiryDeptContactsDraft[dept].push({ name: '', email: '' });
  renderDeptContactsTable();
}

function removeDeptContact(dept, idx) {
  contractExpiryDeptContactsDraft[dept]?.splice(idx, 1);
  renderDeptContactsTable();
}

function updateDeptContactField(dept, idx, field, value) {
  if (!contractExpiryDeptContactsDraft[dept]?.[idx]) return;
  contractExpiryDeptContactsDraft[dept][idx][field] = value;
}

function saveContractExpiryDeptContacts() {
  // Loại dòng chưa nhập gì (cả tên lẫn email đều rỗng) và phòng ban không còn dòng nào trước khi lưu.
  const cleaned = {};
  for (const dept of Object.keys(contractExpiryDeptContactsDraft)) {
    const rows = (contractExpiryDeptContactsDraft[dept] || [])
      .filter(c => (c.name || '').trim() || (c.email || '').trim())
      .map(c => ({ name: (c.name || '').trim(), email: (c.email || '').trim() }));
    if (rows.length) cleaned[dept] = rows;
  }
  DB.contractExpiryDeptContacts = cleaned;
  contractExpiryDeptContactsDraft = JSON.parse(JSON.stringify(cleaned));
  syncStorage('contractExpiryDeptContacts');
  logSystemAction('CONFIG', 'UPDATE_CONTRACT_EXPIRY_CONTACTS', 'Cập nhật người phụ trách nhận thông báo hết hạn hợp đồng theo phòng ban.', 'SUCCESS', 'EMAIL_CONFIG');
  alert('✅ Đã lưu người phụ trách theo phòng ban!');
  renderDeptContactsTable();
}

// --- CÁ NHÂN HÓA USER ---
// Tab đang hiện trong #profileModal — 4 tab tách riêng (xem setProfileSubTab()), nút Mã PIN/Vân Tay chỉ
// hiện khi áp dụng cho tài khoản đang đăng nhập (openProfileModal() bật/tắt).
function setProfileSubTab(tab) {
  const panels = { INFO: 'profileSubInfo', PASSWORD: 'profileSubPassword', PIN: 'pfPinSection', WEBAUTHN: 'pfWebauthnSection', TOTP: 'pfTotpSection' };
  Object.entries(panels).forEach(([key, id]) => {
    document.getElementById(id)?.classList.toggle('hidden', key !== tab);
  });
  const buttons = { INFO: 'btnProfileSubInfo', PASSWORD: 'btnProfileSubPassword', PIN: 'btnProfileSubPin', WEBAUTHN: 'btnProfileSubWebauthn', TOTP: 'btnProfileSubTotp' };
  Object.entries(buttons).forEach(([key, id]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const active = key === tab;
    btn.classList.toggle('bg-blue-700', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-gray-200', !active);
    btn.classList.toggle('text-gray-700', !active);
  });
}

function openProfileModal() {
  if (!currentUser) return;
  document.getElementById('pfUsername').value = currentUser.username;
  document.getElementById('pfFullName').value = currentUser.name || '';
  document.getElementById('pfEmail').value = currentUser.email || '';
  document.getElementById('pfPhone').value = currentUser.phone || '';
  document.getElementById('pfCurrentPass').value = '';
  document.getElementById('pfNewPass').value = '';
  document.getElementById('pfConfirmPass').value = '';

  // Chỉ người đang ở mức xác thực phê duyệt PIN (perms.approverAuthLevel = 'PIN') mới cần quản lý mã
  // PIN của mình — người khác không thấy tab này, giống cách form Sửa Người Dùng của admin cũng chỉ
  // hiện ô PIN khi chọn đúng mức này (xem onApproverAuthLevelChange()).
  const usesPin = currentUser.perms?.approverAuthLevel === 'PIN';
  document.getElementById('btnProfileSubPin').classList.toggle('hidden', !usesPin);
  if (usesPin) {
    // hasPin do server tính sẵn (toSafeUser() ở routes/auth.js) — true/false, KHÔNG phải giá trị PIN
    // thật. Chưa từng có PIN thì ẩn hẳn ô "PIN hiện tại" (không có gì để xác nhận).
    document.getElementById('pfCurrentPinWrap').classList.toggle('hidden', !currentUser.hasPin);
    document.getElementById('pfPinHint').innerText = currentUser.hasPin
      ? 'Nhập đúng mã PIN hiện tại để đổi sang mã mới.'
      : 'Bạn chưa thiết lập mã PIN — đặt mã PIN bên dưới để dùng khi phê duyệt.';
    document.getElementById('pfCurrentPin').value = '';
    document.getElementById('pfNewPin').value = '';
    document.getElementById('pfConfirmPin').value = '';
  }

  const usesWebauthn = canShowBiometricLogin();
  document.getElementById('btnProfileSubWebauthn').classList.toggle('hidden', !usesWebauthn);
  if (usesWebauthn) {
    document.getElementById('pfWebauthnDeviceLabel').value = '';
    renderWebauthnDeviceList();
  }

  // Chỉ admin mới bắt buộc TOTP (xem lib/totp.js) — tab này chỉ hiện cho họ, không áp dụng tài khoản
  // thường. Tới được màn này đã chắc chắn totpEnabled=true (xem chú thích #pfTotpSection).
  document.getElementById('btnProfileSubTotp').classList.toggle('hidden', !currentUser.perms?.admin);
  document.getElementById('pfTotpRemovePassword').value = '';
  document.getElementById('pfTotpRevealPassword').value = '';
  document.getElementById('pfTotpRevealWrap').classList.add('hidden');

  initPwaInstallUI();

  setProfileSubTab('INFO');
  document.getElementById('profileModal').classList.remove('hidden');
}

function closeProfileModal() {
  document.getElementById('profileModal').classList.add('hidden');
}

// Lưu Họ Tên/Email/SĐT — tách riêng khỏi đổi mật khẩu (changeMyPassword()) để mỗi tab tự lưu độc lập,
// không bắt người chỉ muốn sửa thông tin phải đi qua các ô mật khẩu.
async function savePersonalInfo(e) {
  e.preventDefault();
  const newName = document.getElementById('pfFullName').value.trim();
  const newEmail = document.getElementById('pfEmail').value.trim();
  const newPhone = document.getElementById('pfPhone').value.trim();

  // Tự sửa hồ sơ CỦA CHÍNH MÌNH đi qua API riêng (PATCH /api/auth/me) thay vì ghi đè nguyên cả
  // collection "users" — vì "users" giờ chỉ Admin mới có quyền ghi ở server (xem routes/data.js).
  try {
    const res = await fetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, email: newEmail, phone: newPhone })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(body.error || '⛔ Lỗi cập nhật thông tin cá nhân');
    }
    const updated = await res.json();
    currentUser = updated;
    const userIdx = DB.users.findIndex(u => u.username === currentUser.username);
    if (userIdx !== -1) DB.users[userIdx] = { ...DB.users[userIdx], ...updated };
  } catch (err) {
    return alert('⛔ Không thể kết nối tới máy chủ: ' + err.message);
  }

  document.getElementById('userInfo').innerText = `${currentUser.name} (${currentUser.dept})`;
  document.getElementById('userPhoneInfo').innerText = `📞 ${currentUser.phone || 'Chưa có SĐT'} | ✉️ ${currentUser.email || 'Chưa có Email'}`;

  closeProfileModal();
  alert('✅ Cập nhật thông tin cá nhân thành công!');
}

// Đổi mật khẩu — tách riêng khỏi savePersonalInfo() (xem trên). Bắt buộc nhập đủ 3 ô vì tab này CHỈ
// dùng để đổi mật khẩu (không còn kiêm "để trống = giữ nguyên" như form gộp trước đây).
async function changeMyPassword(e) {
  e.preventDefault();
  const currentPass = document.getElementById('pfCurrentPass').value.trim();
  const newPass = document.getElementById('pfNewPass').value.trim();
  const confirmPass = document.getElementById('pfConfirmPass').value.trim();

  if (newPass !== confirmPass) return alert('❌ Mật khẩu xác nhận không khớp!');
  if (newPass.length < 8) return alert('❌ Mật khẩu phải có ít nhất 8 ký tự!');
  if (!currentPass) return alert('❌ Vui lòng nhập mật khẩu hiện tại!');

  try {
    const res = await fetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPass, currentPassword: currentPass })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(body.error || '⛔ Lỗi đổi mật khẩu');
    }
    const updated = await res.json();
    currentUser = updated;
    const userIdx = DB.users.findIndex(u => u.username === currentUser.username);
    if (userIdx !== -1) DB.users[userIdx] = { ...DB.users[userIdx], ...updated };
  } catch (err) {
    return alert('⛔ Không thể kết nối tới máy chủ: ' + err.message);
  }

  document.getElementById('pfCurrentPass').value = '';
  document.getElementById('pfNewPass').value = '';
  document.getElementById('pfConfirmPass').value = '';

  closeProfileModal();
  logSystemAction('USER_MGM', 'CHANGE_OWN_PASSWORD', 'Tự đổi mật khẩu đăng nhập của chính mình.', 'SUCCESS', currentUser.username);
  alert('✅ Đổi mật khẩu thành công!');
}

// Đổi/thiết lập mã PIN phê duyệt của CHÍNH mình — tách riêng khỏi savePersonalProfile() vì đi qua route
// riêng có xác nhận PIN cũ (POST /api/auth/change-pin, xem routes/auth.js), khác PATCH /api/auth/me của
// tên/email/SĐT/mật khẩu. Chỉ hiện được ở #profileModal khi perms.approverAuthLevel = 'PIN'
// (xem openProfileModal()).
async function changeMyApprovalPin() {
  const currentPin = document.getElementById('pfCurrentPin').value.trim();
  const newPin = document.getElementById('pfNewPin').value.trim();
  const confirmPin = document.getElementById('pfConfirmPin').value.trim();

  if (!newPin) return alert('❌ Vui lòng nhập mã PIN mới!');
  if (!/^\d{4,}$/.test(newPin)) return alert('❌ Mã PIN phải là dãy số, tối thiểu 4 chữ số!');
  if (newPin !== confirmPin) return alert('❌ Mã PIN xác nhận không khớp!');
  if (currentUser.hasPin && !currentPin) return alert('❌ Vui lòng nhập mã PIN hiện tại!');

  try {
    const res = await fetch('/api/auth/change-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPin: currentPin || undefined, newPin })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return alert(`⛔ ${body.error || 'Không thể đổi mã PIN'}`);

    currentUser = body;
    const userIdx = DB.users.findIndex(u => u.username === currentUser.username);
    if (userIdx !== -1) DB.users[userIdx] = { ...DB.users[userIdx], ...body };

    document.getElementById('pfCurrentPin').value = '';
    document.getElementById('pfNewPin').value = '';
    document.getElementById('pfConfirmPin').value = '';
    document.getElementById('pfCurrentPinWrap').classList.remove('hidden');
    document.getElementById('pfPinHint').innerText = 'Nhập đúng mã PIN hiện tại để đổi sang mã mới.';
    logSystemAction('USER_MGM', 'CHANGE_OWN_PIN', 'Tự đổi mã PIN phê duyệt của chính mình.', 'SUCCESS', currentUser.username);
    alert('✅ Đã cập nhật mã PIN phê duyệt!');
  } catch (err) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + err.message);
  }
}

// --- ĐĂNG NHẬP & TABS ---

// CAPTCHA số — chỉ bật khi server trả về challenge thật (đã bật CAPTCHA_ENABLED=true trong .env, xem
// lib/captcha.js). GET /api/captcha trả 404 khi tắt -> captchaId giữ null, login() bỏ qua toàn bộ phần
// CAPTCHA, hành vi giống hệt trước đây. Mã vẽ HOÀN TOÀN trên server (SVG), không gọi dịch vụ ngoài nào.
let captchaId = null;

// focusAfter: true khi gọi để lấy mã MỚI SAU 1 lượt đăng nhập vừa submit (đúng/sai đều gọi, xem
// login()) — tự đưa con trỏ vào thẳng ô nhập mã mới, đỡ người dùng phải bấm chuột lại. KHÔNG bật ở
// lượt gọi lúc tải trang lần đầu (tránh cướp focus khỏi ô Tên đăng nhập).
async function refreshCaptcha(focusAfter = false) {
  // Phản hồi ngay khi BẮT ĐẦU tải mã mới (không đợi hết round-trip mới đổi gì trên màn hình) — trước
  // đây ảnh CAPTCHA giữ nguyên y hệt mã VỪA NHẬP SAI cho tới khi có phản hồi, khiến thao tác cảm giác
  // "đứng hình"/chậm dù request vẫn đang xử lý bình thường. Chỉ áp dụng khi ô CAPTCHA đã đang hiện sẵn
  // (đúng là 1 lượt refresh, không phải lần tải trang đầu tiên khi còn chưa biết server có bật CAPTCHA
  // hay không — tránh nháy chữ "Đang tải" rồi lại ẩn ngay nếu server tắt CAPTCHA).
  const fieldEl = document.getElementById('captchaField');
  const imgWrap = document.getElementById('captchaImgWrap');
  if (imgWrap && fieldEl && !fieldEl.classList.contains('hidden')) {
    imgWrap.innerHTML = '<span style="font-size:11px;color:#94a3b8;padding:0 8px;">Đang tải mã mới…</span>';
  }
  try {
    const res = await fetch('/api/captcha');
    if (res.status === 404) {
      captchaId = null;
      document.getElementById('captchaField').classList.add('hidden');
      return;
    }
    const cfg = await res.json();
    captchaId = cfg.captchaId;
    document.getElementById('captchaImgWrap').innerHTML = cfg.svg;
    document.getElementById('txtCaptcha').value = '';
    document.getElementById('captchaField').classList.remove('hidden');
    if (focusAfter) document.getElementById('txtCaptcha').focus();
  } catch (e) {
    console.warn('Không tải được CAPTCHA:', e.message);
  }
}
refreshCaptcha();

// HTML gốc của nút "Đăng Nhập"/"Đăng nhập bằng vân tay" — chụp lại NGAY LÚC TẢI TRANG (trước khi bất kỳ
// lượt đăng nhập nào chạy) để dùng làm giá trị "trả lại nguyên trạng" ở resetLoginWidgets()/
// resetBiometricLoginWidget() bên dưới — không thể chụp động ngay trước lúc reset như trước đây nữa vì
// đăng nhập THÀNH CÔNG giờ cố tình không tự reset (xem chú thích trong login()), lúc logout() gọi lại
// hàm reset thì nút có thể đang ở trạng thái "Đang đăng nhập…"/"Đang xác thực…" chứ không còn nguyên bản.
const btnLoginOriginalHTML = document.getElementById('btnLogin')?.innerHTML || 'Đăng nhập';
const btnBiometricLoginOriginalHTML = document.getElementById('btnBiometricLogin')?.innerHTML || 'Đăng nhập bằng vân tay / Face ID';

// Trả nút "Đăng Nhập" + ô CAPTCHA + nút "↻ Lấy mã khác" về trạng thái sẵn sàng nhập lại (mở khoá, đổi chữ
// nút về nguyên bản, lấy 1 mã CAPTCHA MỚI). Dùng khi đăng nhập THẤT BẠI (sai mật khẩu/CAPTCHA, lỗi mạng,
// phiên không lưu được) hoặc lỗi bất ngờ lúc tải giao diện chính, VÀ khi đăng xuất (để lần đăng nhập SAU
// vẫn dùng form bình thường được) — xem chú thích đầy đủ trong login()/logout() về lý do đăng nhập THÀNH
// CÔNG cố tình KHÔNG gọi hàm này.
function resetLoginWidgets(focusCaptcha = true) {
  const btn = document.getElementById('btnLogin');
  const btnCaptchaRefresh = document.getElementById('btnCaptchaRefresh');
  const txtCaptchaEl = document.getElementById('txtCaptcha');
  if (btn) { btn.disabled = false; btn.innerHTML = btnLoginOriginalHTML; }
  if (btnCaptchaRefresh) btnCaptchaRefresh.disabled = false;
  if (txtCaptchaEl) txtCaptchaEl.disabled = false;
  loginInFlight = false;
  // Mở lại nút "Đăng nhập bằng vân tay" đã bị login() khoá mờ lúc bắt đầu — trừ khi đúng lúc đó nhánh vân
  // tay LẠI đang chạy dở (biometricLoginInFlight), thì để nguyên, tránh mở nhầm 1 nút đang thật sự bận.
  if (!biometricLoginInFlight) {
    const btnBio = document.getElementById('btnBiometricLogin');
    if (btnBio) btnBio.disabled = false;
  }
  if (captchaId) refreshCaptcha(focusCaptcha);
}

// Cùng khuôn resetLoginWidgets() ở trên, riêng cho nút vân tay/Face ID (không đụng gì tới CAPTCHA).
function resetBiometricLoginWidget() {
  const btn = document.getElementById('btnBiometricLogin');
  if (btn) { btn.disabled = false; btn.innerHTML = btnBiometricLoginOriginalHTML; }
  biometricLoginInFlight = false;
  // Mở lại nút "Đăng nhập" (mật khẩu) đã bị loginWithBiometric() khoá mờ lúc bắt đầu — cùng lý do/cách
  // bảo vệ chéo với nhánh biometricLoginInFlight ở resetLoginWidgets() phía trên.
  if (!loginInFlight) {
    const btnLoginEl = document.getElementById('btnLogin');
    if (btnLoginEl) btnLoginEl.disabled = false;
  }
}

// ==========================================
// ĐĂNG NHẬP BẰNG VÂN TAY/FACE ID (WebAuthn/FIDO2, xem lib/webauthn.js) — chỉ hiện nút khi trình duyệt
// CÓ khả năng WebAuthn (API navigator.credentials/window.PublicKeyCredential tồn tại — tự vắng mặt
// trên trình duyệt cũ hoặc khi trang KHÔNG chạy qua HTTPS thật/localhost, không cần server báo trước
// qua flag riêng). Thư viện SimpleWebAuthnBrowser (tự lưu trên server, không qua CDN — cùng lý do với
// html2canvas/jsPDF ở dưới) chỉ tải LÚC THỰC SỰ BẤM nút, không tải sẵn lúc mở trang đăng nhập.
// ==========================================
function canShowBiometricLogin() {
  return typeof window.PublicKeyCredential !== 'undefined';
}
if (canShowBiometricLogin()) {
  document.getElementById('btnBiometricLogin')?.classList.remove('hidden');
}

let biometricLoginInFlight = false;

// Thiết bị "nhớ" tài khoản đã đăng nhập thành công lần gần nhất (kiểu app SeABank) — thuần localStorage
// phía trình duyệt (không phải dữ liệu WebAuthn thật, chỉ là gợi ý UI: máy NÀY từng đăng nhập thành công
// cho user NÀY, bằng BẤT KỲ phương thức nào — mật khẩu, mật khẩu+TOTP, hay vân tay/Face ID). Ghi ở đầu
// proceedAfterAuth() (điểm hội tụ chung của cả 3 luồng đăng nhập) và ở registerBiometricDevice() lúc
// đăng ký vân tay thành công; xoá khi gỡ hết thiết bị vân tay (deleteBiometricDevice()) — KHÔNG xoá lúc
// logout(), vì mục đích là nhớ xuyên suốt nhiều lượt đăng nhập trên cùng máy.
// Giữ NGUYÊN tên key localStorage cũ (đã có dữ liệu người dùng thật) dù không còn giới hạn riêng WebAuthn.
const RECOGNIZED_LOGIN_KEY = 'vpdt_webauthn_username';
function getRecognizedLogin() {
  try {
    const raw = localStorage.getItem(RECOGNIZED_LOGIN_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.username) {
        return { username: parsed.username, name: parsed.name || parsed.username };
      }
      return null;
    } catch (e) {
      // Tương thích ngược: dữ liệu ghi TRƯỚC đợt này là raw username string (không phải JSON) —
      // JSON.parse throw, coi thẳng chuỗi cũ đó là username, chưa có tên đầy đủ để hiện.
      return { username: raw, name: raw };
    }
  } catch (e) { return null; }
}
function setRecognizedLogin(username, name) {
  try {
    if (username) localStorage.setItem(RECOGNIZED_LOGIN_KEY, JSON.stringify({ username, name: name || username }));
    else localStorage.removeItem(RECOGNIZED_LOGIN_KEY);
  } catch (e) { /* Safari duyệt riêng tư/chặn localStorage — bỏ qua, không ảnh hưởng đăng nhập bằng mật khẩu */ }
}

// Ẩn ô gõ Tên đăng nhập, thay bằng dòng hiện tên đầy đủ + nút "Tài khoản khác" khi máy này đã "nhớ" một
// tài khoản (đã đăng nhập thành công ít nhất 1 lần, bằng BẤT KỲ phương thức nào) — điền sẵn #txtUser để
// cả login() (mật khẩu) lẫn loginWithBiometric() dùng được ngay, không cần gõ lại. Điều kiện hiện UI này
// ĐỘC LẬP với việc trình duyệt có hỗ trợ WebAuthn hay không (canShowBiometricLogin() chỉ quyết định
// riêng việc hiện/ẩn nút vân tay #btnBiometricLogin) — có tài khoản để nhớ và trình duyệt có vân tay là
// 2 việc khác nhau, không nên gộp điều kiện.
// Gọi lại được nhiều lần (lúc tải trang VÀ sau logout()) nên phải tự đảo ngược đúng trạng thái mỗi lần.
function initRememberedLoginUser() {
  const wrap = document.getElementById('loginRememberedUserWrap');
  const fieldWrap = document.getElementById('loginUserFieldWrap');
  const recognized = getRecognizedLogin();
  if (recognized) {
    document.getElementById('txtUser').value = recognized.username;
    document.getElementById('loginRememberedUserName').textContent = recognized.name || recognized.username;
    wrap.classList.remove('hidden');
    fieldWrap.classList.add('hidden');
  } else {
    wrap.classList.add('hidden');
    fieldWrap.classList.remove('hidden');
  }
}
initRememberedLoginUser();

// Bấm "Tài khoản khác" — hiện lại ô nhập thủ công (trống, focus sẵn) để đăng nhập tài khoản khác
// TRÊN CÙNG thiết bị này (máy dùng chung). KHÔNG xoá tài khoản đã nhớ trong localStorage — chỉ đổi tạm
// hiển thị cho lượt đăng nhập này, tải lại trang sau đó vẫn quay về đúng tài khoản đã nhớ như cũ.
function switchLoginUser() {
  document.getElementById('loginRememberedUserWrap').classList.add('hidden');
  document.getElementById('loginUserFieldWrap').classList.remove('hidden');
  const txtUser = document.getElementById('txtUser');
  txtUser.value = '';
  txtUser.focus();
}

async function loginWithBiometric() {
  if (biometricLoginInFlight || loginInFlight) return;
  const u = document.getElementById('txtUser').value.trim();
  if (!u) return alert('Vui lòng nhập tên đăng nhập trước khi dùng vân tay!');

  biometricLoginInFlight = true;
  const btn = document.getElementById('btnBiometricLogin');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loginpage-spinner"></span> Đang xác thực…'; }
  // Mờ luôn nút "Đăng nhập" (mật khẩu) trong lúc chờ vân tay/Face ID — 2 nút cùng bấm được (dù không
  // cùng lúc chạy thật, do check biometricLoginInFlight/loginInFlight ở đầu hàm) từng khiến người dùng
  // tưởng nút "Đăng nhập" vẫn dùng được bình thường, dễ bấm nhầm/gõ lại mật khẩu trong lúc hộp thoại vân
  // tay của hệ điều hành đang mở. Mở lại ở resetBiometricLoginWidget().
  const btnLoginEl = document.getElementById('btnLogin');
  if (btnLoginEl) btnLoginEl.disabled = true;

  try {
    await loadVendorScript('/vendor/simplewebauthn/browser.min.js');

    const optRes = await fetch('/api/auth/webauthn/login-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u })
    });
    if (!optRes.ok) {
      const body = await optRes.json().catch(() => ({}));
      resetBiometricLoginWidget();
      return alert(body.error || 'Không thể khởi tạo đăng nhập vân tay.');
    }
    const optionsJSON = await optRes.json();

    let assertion;
    try {
      assertion = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
    } catch (e) {
      // Người dùng bấm Huỷ ở hộp thoại vân tay của hệ điều hành (hoặc hết thời gian chờ) — KHÔNG coi
      // là lỗi hệ thống, chỉ lặng lẽ dừng lại để họ dùng mật khẩu bên trên như bình thường.
      resetBiometricLoginWidget();
      if (e.name === 'NotAllowedError') return;
      return alert('⛔ Không đọc được vân tay/Face ID: ' + e.message);
    }

    const verifyRes = await fetch('/api/auth/webauthn/login-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, response: assertion })
    });
    if (!verifyRes.ok) {
      const body = await verifyRes.json().catch(() => ({}));
      resetBiometricLoginWidget();
      return alert(body.error || 'Không thể đăng nhập bằng vân tay.');
    }
    const user = await verifyRes.json();

    // Xác nhận cookie phiên thực sự được lưu — cùng lý do/cùng cách kiểm tra với login() (mật khẩu)
    // bên dưới, xem chú thích đầy đủ ở đó.
    const sessionCheck = await fetch('/api/auth/me').catch(() => null);
    if (!sessionCheck || !sessionCheck.ok) {
      resetBiometricLoginWidget();
      return alert('⚠️ Đăng nhập đúng nhưng trình duyệt KHÔNG lưu được phiên đăng nhập. Vui lòng thử lại bằng địa chỉ https://, hoặc liên hệ quản trị viên hệ thống để kiểm tra cấu hình.');
    }

    logSystemAction('USER_MGM', 'LOGIN_SUCCESS', 'Đăng nhập bằng vân tay/Face ID thành công.', 'SUCCESS', user.username);
    // ĐĂNG NHẬP THÀNH CÔNG — cố tình KHÔNG gọi resetBiometricLoginWidget() ở đây, giữ nguyên trạng thái
    // "Đang xác thực…" cho tới khi thật sự chuyển màn hình, tránh đúng lỗi UX đã sửa ở login() (mật khẩu)
    // bên dưới — xem chú thích đầy đủ ở đó. Chỉ bọc riêng proceedAfterAuth() để có lưới an toàn nếu lỗi
    // bất ngờ lúc tải giao diện chính, không để nút kẹt vĩnh viễn.
    try {
      await proceedAfterAuth(user);
    } catch (e) {
      console.error('Lỗi khi vào giao diện chính sau đăng nhập vân tay:', e);
      resetBiometricLoginWidget();
      alert('⛔ Đăng nhập thành công nhưng có lỗi khi tải giao diện chính. Vui lòng tải lại trang (F5).');
    }
  } catch (e) {
    resetBiometricLoginWidget();
    alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }
}

// Chặn gọi chồng /api/auth/login — trước đây chỉ disable nút Đăng nhập (btn.disabled = true) ngay khi
// login() bắt đầu chạy, nhưng KHÔNG khoá luôn ô nhập mã CAPTCHA/nút "↻ Lấy mã khác": nếu người dùng sốt
// ruột (round-trip bcrypt + SQL Server có độ trễ thật, cảm giác "chậm") tự bấm "↻" TRONG LÚC request cũ
// còn đang treo, biến `captchaId` toàn cục bị đè bởi ảnh MỚI trong khi request cũ vẫn đang gửi answer
// khớp với ảnh CŨ — tới khi request cũ trả lời xong, khối finally lại refresh() THÊM 1 LẦN NỮA (đọc
// đúng captchaId hiện tại, đã bị đổi), khiến ảnh đổi liên tục "một mình" và người dùng cứ phải đoán lại
// mã theo ảnh mới nhất. `loginInFlight` chặn đứng khả năng 1 lượt login() thứ 2 chạy chồng lên lượt đầu
// (dù do double-click/Enter dồn dập hay do tự bấm refresh) — xem thêm phần khoá cả captcha widget dưới.
let loginInFlight = false;

// Username đang chờ bước 2 (nhập mã TOTP) — null khi đang ở bước 1 (mật khẩu) bình thường. Đặt sau khi
// POST /login trả totpRequired:true (mật khẩu đúng nhưng admin đã bật TOTP — CHƯA có cookie phiên nào ở
// bước đó); login() (được form submit gọi lại khi bấm nút lần 2) tự rẽ nhánh sang submitTotpLoginStep()
// thay vì gửi lại mật khẩu, vì cùng 1 nút/form được dùng chung cho cả 2 bước.
let pendingTotpLoginUsername = null;

async function login() {
  if (loginInFlight) return;
  if (pendingTotpLoginUsername) return submitTotpLoginStep();
  const u = document.getElementById('txtUser').value.trim();
  const p = document.getElementById('txtPass').value.trim();
  if (!u || !p) return alert('Vui lòng nhập tên đăng nhập và mật khẩu!');

  let captchaAnswer;
  if (captchaId) {
    captchaAnswer = document.getElementById('txtCaptcha').value.trim();
    if (!captchaAnswer) return alert('Vui lòng nhập mã xác nhận trong ảnh.');
  }

  loginInFlight = true;
  const btn = document.getElementById('btnLogin');
  const btnCaptchaRefresh = document.getElementById('btnCaptchaRefresh');
  const txtCaptchaEl = document.getElementById('txtCaptcha');
  // Đổi hẳn chữ trên nút + thêm icon xoay (không chỉ disable/mờ đi) — chữ đổi đơn thuần rất dễ bị bỏ
  // qua khi mắt người dùng đang nhìn vào ảnh CAPTCHA, khiến thao tác cảm giác "đứng hình"/chậm dù
  // request (xác minh mật khẩu bcrypt + CAPTCHA) thực ra vẫn đang xử lý bình thường. Khoá luôn cả ô
  // nhập mã + nút "↻ Lấy mã khác" trong lúc chờ — lý do xem chú thích loginInFlight ở trên.
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loginpage-spinner"></span> Đang đăng nhập…'; }
  if (btnCaptchaRefresh) btnCaptchaRefresh.disabled = true;
  if (txtCaptchaEl) txtCaptchaEl.disabled = true;
  // Mờ luôn nút "Đăng nhập bằng vân tay" trong lúc chờ — cùng lý do/khuôn với chiều ngược lại ở
  // loginWithBiometric(), mở lại ở resetLoginWidgets().
  const btnBioEl = document.getElementById('btnBiometricLogin');
  if (btnBioEl) btnBioEl.disabled = true;
  let user;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p, captchaId, captchaAnswer })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      resetLoginWidgets();
      return alert(body.error || 'Tài khoản hoặc mật khẩu không chính xác!');
    }
    user = await res.json();
  } catch (e) {
    resetLoginWidgets();
    return alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }

  // Admin đã bật TOTP -> mật khẩu đúng nhưng CHƯA đăng nhập xong (KHÔNG có cookie phiên nào được cấp ở
  // response này) — chuyển sang bước 2 nhập mã 2 lớp thay vì coi như đăng nhập thành công.
  if (user.totpRequired) {
    enterTotpLoginStep(user.username, btn, btnCaptchaRefresh, txtCaptchaEl, btnBioEl);
    return;
  }

  // ĐĂNG NHẬP THÀNH CÔNG — cố tình KHÔNG gọi resetLoginWidgets() ở đây (khác bản trước): trước đây khối
  // finally luôn chạy dù thành công hay thất bại, bật lại nút "Đăng Nhập" + lấy ngay 1 mã CAPTCHA MỚI
  // TRẮNG TRƠN ngay khi POST /login vừa trả lời xong — nhưng đăng nhập thành công thì CHƯA vào giao diện
  // chính ngay, còn phải xác nhận cookie phiên (bước dưới) rồi tải toàn bộ dữ liệu nghiệp vụ qua
  // initDatabase() (từng đo được 5-7 giây ở lần đầu, xem task điều tra hiệu năng trước đây) mới thật sự
  // ẩn màn đăng nhập. Trong khoảng vài giây "trông như đã xong" đó, người dùng thấy nút trở lại bình
  // thường + CAPTCHA trắng mới nên hiểu lầm là CHƯA bấm/CHƯA đăng nhập, gõ mã mới rồi bấm lại — đây chính
  // là nguồn gốc lỗi UX cần sửa. Giữ nguyên nút "Đang đăng nhập…"/CAPTCHA cũ liên tục cho tới khi THẬT SỰ
  // chuyển màn hình. Chỉ còn 3 chỗ gọi resetLoginWidgets(): 2 nhánh lỗi ở trên, nhánh lỗi xác nhận phiên
  // ngay dưới đây, và logout() (để lần đăng nhập SAU vẫn dùng form bình thường được).
  const sessionCheck = await fetch('/api/auth/me').catch(() => null);
  if (!sessionCheck || !sessionCheck.ok) {
    resetLoginWidgets();
    return alert('⚠️ Đăng nhập đúng nhưng trình duyệt KHÔNG lưu được phiên đăng nhập, nên chưa thể vào hệ thống. Nguyên nhân thường gặp nhất: đang truy cập bằng địa chỉ http:// (không có https). Vui lòng thử lại bằng địa chỉ https://, hoặc liên hệ quản trị viên hệ thống để kiểm tra cấu hình.');
  }

  logSystemAction('USER_MGM', 'LOGIN_SUCCESS', 'Đăng nhập thành công.', 'SUCCESS', user.username);
  // Bọc riêng proceedAfterAuth() — lưới an toàn cho trường hợp cực hiếm có lỗi JS bất ngờ lúc dựng giao
  // diện chính, tránh để nút/CAPTCHA kẹt vĩnh viễn ở trạng thái "Đang đăng nhập…" không bấm được.
  try {
    await proceedAfterAuth(user);
  } catch (e) {
    console.error('Lỗi khi vào giao diện chính sau đăng nhập:', e);
    resetLoginWidgets();
    alert('⛔ Đăng nhập thành công nhưng có lỗi khi tải giao diện chính. Vui lòng tải lại trang (F5).');
  }
}

// Chuyển màn đăng nhập sang bước 2 (nhập mã TOTP) — gọi khi POST /login trả totpRequired:true. Ẩn các
// trường bước 1 (tên đăng nhập/mật khẩu/CAPTCHA/nút vân tay), hiện ô nhập mã, và mở lại nút "Đăng nhập"
// (đang bị login() khoá tạm) để dùng cho lượt bấm kế tiếp — login() sẽ tự rẽ sang submitTotpLoginStep()
// vì pendingTotpLoginUsername đã được đặt.
function enterTotpLoginStep(username, btn, btnCaptchaRefresh, txtCaptchaEl, btnBioEl) {
  loginInFlight = false;
  pendingTotpLoginUsername = username;
  if (btn) { btn.disabled = false; btn.innerHTML = btnLoginOriginalHTML; }
  if (btnCaptchaRefresh) btnCaptchaRefresh.disabled = false;
  if (txtCaptchaEl) txtCaptchaEl.disabled = false;
  if (btnBioEl) { btnBioEl.disabled = false; btnBioEl.classList.add('hidden'); }
  document.getElementById('loginUserFieldWrap').classList.add('hidden');
  document.getElementById('loginPassFieldWrap').classList.add('hidden');
  document.getElementById('captchaField').classList.add('hidden');
  document.getElementById('loginTotpUsernameLabel').textContent = username;
  document.getElementById('loginTotpStepWrap').classList.remove('hidden');
  const codeEl = document.getElementById('txtTotpCode');
  if (codeEl) { codeEl.value = ''; setTimeout(() => codeEl.focus(), 50); }
}

// Bấm "← Quay lại đăng nhập bằng mật khẩu" ở bước 2 — quay về nguyên trạng bước 1, không giữ lại mật
// khẩu cũ đã gõ (bắt gõ lại, tránh hiểu lầm mật khẩu vẫn còn "hợp lệ" trong khi phiên chờ TOTP đã bỏ).
function cancelTotpLoginStep() {
  pendingTotpLoginUsername = null;
  document.getElementById('loginTotpStepWrap').classList.add('hidden');
  document.getElementById('loginUserFieldWrap').classList.remove('hidden');
  document.getElementById('loginPassFieldWrap').classList.remove('hidden');
  if (captchaId) document.getElementById('captchaField').classList.remove('hidden');
  const bioBtn = document.getElementById('btnBiometricLogin');
  if (bioBtn && canShowBiometricLogin()) bioBtn.classList.remove('hidden');
  const passEl = document.getElementById('txtPass');
  if (passEl) passEl.value = '';
}

// Bước 2 của đăng nhập — gửi mã 6 số HOẶC mã khôi phục (POST /api/auth/verify-totp-login), tự phân
// biệt theo độ dài sau khi lọc bỏ ký tự không phải số (mã TOTP luôn 6 số, mã khôi phục luôn 8 số dù
// hiển thị có gạch ngang XXXX-XXXX — xem lib/totp.js generateBackupCodes()/normalizeBackupCode()).
async function submitTotpLoginStep() {
  const username = pendingTotpLoginUsername;
  const raw = (document.getElementById('txtTotpCode').value || '').trim();
  const digitsOnly = raw.replace(/[^0-9]/g, '');
  if (!digitsOnly) return alert('Vui lòng nhập mã xác thực.');
  const payload = { username };
  if (digitsOnly.length === 6) payload.code = digitsOnly; else payload.backupCode = digitsOnly;

  loginInFlight = true;
  const btn = document.getElementById('btnLogin');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loginpage-spinner"></span> Đang xác thực…'; }

  let user;
  try {
    const res = await fetch('/api/auth/verify-totp-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      loginInFlight = false;
      if (btn) { btn.disabled = false; btn.innerHTML = btnLoginOriginalHTML; }
      return alert(body.error || 'Mã xác thực không đúng');
    }
    user = await res.json();
  } catch (e) {
    loginInFlight = false;
    if (btn) { btn.disabled = false; btn.innerHTML = btnLoginOriginalHTML; }
    return alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }

  pendingTotpLoginUsername = null;
  const sessionCheck = await fetch('/api/auth/me').catch(() => null);
  if (!sessionCheck || !sessionCheck.ok) {
    loginInFlight = false;
    if (btn) { btn.disabled = false; btn.innerHTML = btnLoginOriginalHTML; }
    return alert('⚠️ Đăng nhập đúng nhưng trình duyệt KHÔNG lưu được phiên đăng nhập. Vui lòng thử lại bằng địa chỉ https://, hoặc liên hệ quản trị viên hệ thống để kiểm tra cấu hình.');
  }

  logSystemAction('USER_MGM', 'LOGIN_SUCCESS', 'Đăng nhập thành công (đã qua xác thực 2 lớp).', 'SUCCESS', user.username);
  try {
    await proceedAfterAuth(user);
  } catch (e) {
    console.error('Lỗi khi vào giao diện chính sau đăng nhập:', e);
    loginInFlight = false;
    if (btn) { btn.disabled = false; btn.innerHTML = btnLoginOriginalHTML; }
    alert('⛔ Đăng nhập thành công nhưng có lỗi khi tải giao diện chính. Vui lòng tải lại trang (F5).');
  }
}

// Sau khi có phiên đăng nhập hợp lệ (đăng nhập mới HOẶC khôi phục phiên cũ lúc tải lại trang) — nếu
// tài khoản đang bị đánh dấu bắt buộc đổi mật khẩu (mật khẩu tạm do admin đặt, hoặc còn đang dùng
// đúng mật khẩu mặc định lúc khởi tạo hệ thống), CHỈ hiện modal bắt buộc đổi, KHÔNG tải dữ liệu nghiệp
// vụ hay vào giao diện chính — server cũng chặn mọi API khác cho tới khi đổi xong (xem lib/auth.js
// blockIfMustChangePassword), gọi initDatabase() lúc này sẽ chỉ nhận toàn lỗi 403 vô ích. Admin có
// quyền admin nhưng CHƯA bật TOTP cùng khuôn — hiện modal bắt buộc thiết lập 2 lớp thay vì vào thẳng
// (xem lib/totp.js/lib/auth.js blockIfMustChangePassword — bắt buộc, không có ngoại lệ).
async function proceedAfterAuth(user) {
  currentUser = user;
  // Nhớ tài khoản này cho MÁY hiện tại (kiểu app SeABank) — áp dụng cho MỌI lượt đăng nhập thành công
  // (mật khẩu thường, mật khẩu+TOTP bước 2, vân tay/Face ID) vì đây là điểm hội tụ chung của cả 3 luồng,
  // KHÔNG chỉ riêng lúc đăng ký vân tay như trước. Lần sau mở trang sẽ tự ẩn ô gõ Tên đăng nhập, hiện tên
  // đầy đủ + nút "Tài khoản khác" (xem initRememberedLoginUser()/getRecognizedLogin()).
  setRecognizedLogin(user.username, user.name);
  if (user.mustChangePassword) {
    hideBootSplash();
    document.getElementById('loginSection').classList.add('hidden');
    document.getElementById('mustChangePasswordModal').classList.remove('hidden');
    return;
  }
  if (user.perms?.admin && !user.totpEnabled) {
    hideBootSplash();
    document.getElementById('loginSection').classList.add('hidden');
    openTotpSetupWall(user);
    return;
  }
  // #bootSplash (hoặc form Đăng Nhập, nếu là lượt đăng nhập thủ công) vẫn hiện NGUYÊN suốt lúc
  // initDatabase() tải dữ liệu — chỉ ẩn đi NGAY TRƯỚC khi finishLogin() thật sự lộ giao diện chính, để
  // không có khoảng trống trắng màn hình giữa 2 lượt ẩn/hiện. Xem chú thích đầy đủ tại hideBootSplash().
  await initDatabase(user);
  dataReady = true;
  hideBootSplash();
  finishLogin(user);
}

function closeMustChangePasswordModal() {
  document.getElementById('mustChangePasswordModal').classList.add('hidden');
}

async function submitMustChangePassword(e) {
  e.preventDefault();
  const newPass = document.getElementById('mcpNewPass').value;
  const confirmPass = document.getElementById('mcpConfirmPass').value;
  if (newPass.length < 8) return alert('❌ Mật khẩu phải có ít nhất 8 ký tự!');
  if (newPass !== confirmPass) return alert('❌ Mật khẩu xác nhận không khớp!');

  try {
    const res = await fetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPass })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(body.error || '⛔ Lỗi đổi mật khẩu');
    }
    const updated = await res.json();
    closeMustChangePasswordModal();
    alert('✅ Đã đổi mật khẩu thành công!');
    logSystemAction('USER_MGM', 'CHANGE_FORCED_PASSWORD', 'Đổi mật khẩu bắt buộc lần đầu thành công.', 'SUCCESS', updated.username);
    await proceedAfterAuth(updated);
  } catch (err) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + err.message);
  }
}

// Phần UI sau khi đã có phiên đăng nhập hợp lệ — dùng chung cho đăng nhập thật (login()) và khôi
// phục phiên cũ khi tải lại trang (tryRestoreSession()), vì cả 2 đều kết thúc bằng cùng 1 trạng thái.
// Thu gọn/mở rộng sidebar — chỉ toggle 1 class trên #userHeader (xem CSS .sidebar-collapsed),
// lưu lựa chọn vào localStorage để giữ nguyên qua các lần load lại trang / đăng nhập lại.
function toggleSidebarCollapse() {
  const collapsed = document.getElementById('userHeader').classList.toggle('sidebar-collapsed');
  localStorage.setItem('vpdt_sidebar_collapsed', collapsed ? '1' : '0');
}

// Sidebar "off-canvas" trên điện thoại (< 768px, xem CSS #userHeader trong khối <style> đầu file) —
// bấm ☰ ở #mobileTopBar mở ra, bấm lại/bấm vào lớp nền mờ/bấm 1 mục điều hướng (xem switchTab()) đều
// đóng lại. Chỉ toggle 1 class .mobile-sidebar-open trên #userHeader, không đụng gì tới hành vi desktop.
function toggleMobileSidebar() {
  const isOpen = document.getElementById('userHeader').classList.contains('mobile-sidebar-open');
  if (isOpen) closeMobileSidebar(); else openMobileSidebar();
}
function openMobileSidebar() {
  document.getElementById('userHeader').classList.add('mobile-sidebar-open');
  document.getElementById('sidebarBackdrop').classList.remove('hidden');
}
function closeMobileSidebar() {
  document.getElementById('userHeader').classList.remove('mobile-sidebar-open');
  document.getElementById('sidebarBackdrop').classList.add('hidden');
}

// Cập nhật thuộc tính accept của các ô chọn tệp TĨNH theo đúng cấu hình "Loại Tệp Cho Phép" của admin
// (DB.uploadFileTypeConfig) — chỉ là gợi ý UI (bộ lọc chọn tệp của trình duyệt), việc chặn thật sự vẫn
// do server quyết định (xem routes/upload.js). Module chưa cấu hình thì giữ nguyên accept mặc định có
// sẵn trong HTML. Gọi lại sau khi lưu cấu hình ở admin để áp dụng ngay không cần tải lại trang. CHUYỂN từ
// module-tailieu.js sang đây (Hạ tầng: nạp module theo cụm, đợt 7) — finishLogin() ngay dưới đây gọi hàm
// này NGAY SAU đăng nhập, trước khi mở bất kỳ tab nào, nên không thể để nằm ở 1 module-*.js nạp lười.
function applyUploadAcceptAttrs() {
  const STATIC_INPUTS = {
    doc: ['docFile'], submission: ['subFile', 'subExtraFiles'], contract: ['contractFile'], internal: ['internalFile']
  };
  const config = DB.uploadFileTypeConfig || {};
  for (const moduleKey in STATIC_INPUTS) {
    const allowed = config[moduleKey];
    if (!Array.isArray(allowed) || !allowed.length) continue;
    const acceptValue = allowed.join(',');
    STATIC_INPUTS[moduleKey].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('accept', acceptValue);
    });
  }
}

function finishLogin(user) {
  currentUser = user;
  migrateDashboardHiddenCardsFromLocalStorage();

  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('userHeader').classList.remove('hidden');
  document.getElementById('mobileTopBar').classList.remove('hidden');
  document.getElementById('userHeader').classList.toggle('sidebar-collapsed', localStorage.getItem('vpdt_sidebar_collapsed') === '1');
  document.getElementById('userInfo').innerText = `${user.name} (${user.dept})`;
  document.getElementById('userPhoneInfo').innerText = `📞 ${user.phone || 'Chưa có SĐT'} | ✉️ ${user.email || 'Chưa có Email'}`;

  document.getElementById('heThongNavWrap').classList.toggle('hidden', !user.perms.admin);
  document.getElementById('btnReportsTab').classList.toggle('hidden', !canAccessReportsModule(user));
  document.getElementById('itSupportNavWrap').classList.toggle('hidden', !canAccessItSupportModule(user));
  document.getElementById('btnItSupportNavRenewal').classList.toggle('hidden', !canManageItSupportClient(user));
  document.getElementById('btnItSubRenewal').classList.toggle('hidden', !canManageItSupportClient(user));
  document.getElementById('btnApprovalHubTab').classList.toggle('hidden', !canAccessApprovalHub(user));
  updateApprovalHubBadge();
  applyUploadAcceptAttrs();
  document.getElementById('btnDocTab').classList.toggle('hidden', !canAccessDocModule(user));

  document.getElementById('btnSubmissionTab').classList.toggle('hidden', !canAccessSubmissionModule(user));
  document.getElementById('hopDongNavWrap').classList.toggle('hidden', !canAccessContractModule(user));
  document.getElementById('btnMeetingTab').classList.toggle('hidden', !canAccessMeetingModule(user));
  document.getElementById('btnMinutesTab').classList.toggle('hidden', !canAccessMeetingMinutesModule(user));
  document.getElementById('btnTaskTab').classList.toggle('hidden', !canAccessTaskModule(user));
  document.getElementById('btnPeriodicReportTab').classList.toggle('hidden', !canAccessPeriodicReportModule(user));
  updateDieuHanhNavVisibility();
  document.getElementById('truyenThongNavWrap').classList.toggle('hidden', !canAccessInternalModule(user));
  document.getElementById('btnCarTab').classList.toggle('hidden', !canAccessCarModule(user));
  document.getElementById('btnVppTab').classList.toggle('hidden', !canAccessVppModule(user));
  document.getElementById('btnUniformTab').classList.toggle('hidden', !canAccessUniformModule(user));
  document.getElementById('btnLicenseTab').classList.toggle('hidden', !canAccessLicenseModule(user));
  updateHanhChinhNavVisibility();
  document.getElementById('btnOfficeSubBuyNav').classList.toggle('hidden', !canAccessOfficeSubTab(user, 'MUA_BAN'));
  document.getElementById('btnOfficeSubFixNav').classList.toggle('hidden', !canAccessOfficeSubTab(user, 'SUA_CHUA'));
  document.getElementById('btnOfficeSubPaymentNav').classList.toggle('hidden', !canAccessPaymentModule(user));
  document.getElementById('btnBudgetNav').classList.toggle('hidden', !canAccessBudgetModule(user));
  updateTongHopNavVisibility();
  document.getElementById('btnOperationOrderNav').classList.toggle('hidden', !canAccessOperationSubTab(user, 'ORDER'));
  document.getElementById('btnOperationStoreNav').classList.toggle('hidden', !canAccessOperationSubTab(user, 'STORE'));
  updateVanHanhNavVisibility();
  updateOperationStoreSubTabVisibility(user);
  document.getElementById('btnHrFeedbackNav').classList.toggle('hidden', !canAccessHrModule(user));
  document.getElementById('btnOrgChartNav').classList.toggle('hidden', !canAccessOrgChartModule(user));
  updateHrNavVisibility();

  populateDropdowns();
  switchTab('dashboard');
  startSessionKeepAlive();
  openTakeTestFromQueryParam();
  applyPwaShortcutParam();
}

// Sau khi quét mã QR ở lớp offline (hoặc bấm link trực tiếp), app mở kèm ?takeTest=<classId> — tự điều
// hướng vào đúng màn "Đăng Ký Của Tôi" của Đào Tạo LMS rồi mở luôn modal làm bài, thay vì bắt học viên
// tự bấm qua nhiều lớp điều hướng (Truyền thông > Đào tạo > Đăng Ký Của Tôi) trên điện thoại vừa quét
// xong. Xoá query param khỏi URL ngay sau khi dùng — tải lại trang (F5) không tự mở lại modal lần nữa.
async function openTakeTestFromQueryParam() {
  const params = new URLSearchParams(window.location.search);
  const classId = Number(params.get('takeTest'));
  if (!Number.isFinite(classId) || !params.has('takeTest')) return;
  history.replaceState(null, '', window.location.pathname);
  if (!canAccessInternalModule(currentUser)) return alert('⛔ Bạn không có quyền truy cập Module Truyền thông nội bộ để làm bài test.');
  // Ha tang: nap module theo cum, dot 7 - switchTab() gio la ham bat dong bo (co the phai nap cum
  // "internalcomms-nhipsong", cum nay tu dong keo theo cum "admin-permgroups" noi setTrainingLmsTab()/
  // openTakeTestModal() (module-internalcomms-daotao.js) dinh nghia) - PHAI await xong roi moi goi tiep.
  try {
    await switchTab('internal');
    setInternalSubTab('TRAINING');
    await ensureFnReady('setTrainingLmsTab');
    setTrainingLmsTab('MY_REGS');
    await ensureFnReady('openTakeTestModal');
    setTimeout(() => openTakeTestModal(classId), 200);
  } catch (err) {
    console.error('openTakeTestFromQueryParam: không tải được mô-đun Đào Tạo', err);
    alert('⛔ Không tải được màn làm bài test. Vui lòng tải lại trang và thử lại.');
  }
}

// Giữ phiên đăng nhập không bị hết hạn khi người dùng vẫn đang mở trang nhưng KHÔNG gọi API nào (vd.
// đang soạn 1 văn bản dài, đọc lâu 1 hồ sơ) — trước đây cơ chế "trượt hạn theo hoạt động" ở
// requireAuth() (lib/auth.js) chỉ cấp lại token mới khi có SẴN 1 request nào đó tới server, mà toàn bộ
// trang không hề có request định kỳ nào cả (không setInterval nào gọi API) nên nếu người dùng im lặng
// quá ~44 phút, token chạm mốc hết hạn tuyệt đối (1h) và request tiếp theo (vd bấm "Lưu") bị 401, văng
// ra ngay giữa chừng, có thể mất nội dung đang nhập dở — đúng triệu chứng "hay bị văng khi đang làm
// việc". Ping nhẹ (chỉ đọc lại /api/auth/me, không tải dữ liệu gì nặng) mỗi 10 phút là đủ dày để token
// luôn được làm mới trước khi chạm ngưỡng, miễn tab còn mở và còn mạng.
let sessionKeepAliveTimer = null;
const SESSION_KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;
function startSessionKeepAlive() {
  stopSessionKeepAlive();
  sessionKeepAliveTimer = setInterval(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.status === 401) {
        stopSessionKeepAlive();
        handleSessionExpired();
      }
    } catch (e) { /* mất mạng tạm thời — bỏ qua, thử lại ở lượt ping kế tiếp */ }
  }, SESSION_KEEPALIVE_INTERVAL_MS);
}
function stopSessionKeepAlive() {
  if (sessionKeepAliveTimer) {
    clearInterval(sessionKeepAliveTimer);
    sessionKeepAliveTimer = null;
  }
}

// Đăng xuất phía server (xoá cookie phiên) — chạy song song (fire-and-forget), không chặn việc dọn
// UI ngay lập tức, vì nhiều nơi gọi logout() đồng bộ (vd. switchTab() khi currentUser rỗng).
function logout() {
  stopSessionKeepAlive();
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  currentUser = null;
  dataReady = false;
  document.getElementById('mustChangePasswordModal').classList.add('hidden');
  document.getElementById('loginSection').classList.remove('hidden');
  // Trả nút "Đăng Nhập"/"Đăng nhập bằng vân tay" về trạng thái dùng được bình thường — kể từ khi login()/
  // loginWithBiometric() cố tình KHÔNG tự reset lúc đăng nhập THÀNH CÔNG (xem chú thích trong 2 hàm đó),
  // logout() là nơi DUY NHẤT còn lại cần làm việc này, nếu không nút sẽ kẹt ở trạng thái "Đang đăng
  // nhập…"/"Đang xác thực…" từ lượt đăng nhập trước, chặn luôn lượt đăng nhập kế tiếp.
  resetLoginWidgets(false);
  resetBiometricLoginWidget();
  // Vẽ lại đúng trạng thái "tài khoản đã nhớ" (ẩn ô gõ Tên đăng nhập + hiện dòng tên/nút đổi tài khoản)
  // cho lượt đăng nhập KẾ TIẾP — nếu lượt vừa đăng xuất từng bấm "Đăng nhập tên khác" (hiện ô gõ tay tạm
  // thời) mà không reset lại ở đây, đăng xuất xong sẽ vẫn kẹt ở ô gõ tay dù máy vẫn còn nhớ tài khoản.
  initRememberedLoginUser();
  document.getElementById('dashboardSection').classList.add('hidden');
  document.getElementById('approvalHubSection').classList.add('hidden');
  document.getElementById('docSection').classList.add('hidden');
  document.getElementById('submissionSection').classList.add('hidden');
  document.getElementById('taskSection').classList.add('hidden');
  document.getElementById('contractSection').classList.add('hidden');
  document.getElementById('meetingSection').classList.add('hidden');
  document.getElementById('minutesSection').classList.add('hidden');
  document.getElementById('internalSection').classList.add('hidden');
  document.getElementById('carSection').classList.add('hidden');
  document.getElementById('vppSection').classList.add('hidden');
  document.getElementById('uniformSection').classList.add('hidden');
  document.getElementById('periodicReportSection').classList.add('hidden');
  document.getElementById('officeSection').classList.add('hidden');
  document.getElementById('budgetSection').classList.add('hidden');
  document.getElementById('systemSection').classList.add('hidden');
  document.getElementById('formSection').classList.add('hidden');
  document.getElementById('adminSection').classList.add('hidden');
  document.getElementById('workflowSection').classList.add('hidden');
  document.getElementById('logSection').classList.add('hidden');
  document.getElementById('reportsSection').classList.add('hidden');
  document.getElementById('itSupportSection').classList.add('hidden');
  document.getElementById('userHeader').classList.add('hidden');
  document.getElementById('mobileTopBar').classList.add('hidden');
  closeMobileSidebar();
}

// "Điều Hành" — nút nav cha bọc dropdown chứa Biên bản họp/Công việc/Báo Cáo Định Kỳ (xem HTML
// #dieuHanhNavWrap). Hiện nút cha nếu có quyền vào ÍT NHẤT 1 trong 3 (mỗi nút con vẫn tự ẩn/hiện riêng
// theo đúng quyền như trước — xem finishLogin()); đóng dropdown khi bấm ra ngoài, cùng khuôn
// subApprovalDropdownPanel.
function updateDieuHanhNavVisibility() {
  const minutesVisible = !document.getElementById('btnMinutesTab').classList.contains('hidden');
  const taskVisible = !document.getElementById('btnTaskTab').classList.contains('hidden');
  const reportVisible = !document.getElementById('btnPeriodicReportTab').classList.contains('hidden');
  document.getElementById('dieuHanhNavWrap').classList.toggle('hidden', !minutesVisible && !taskVisible && !reportVisible);
}
function toggleDieuHanhDropdown(e) {
  e.stopPropagation();
  document.getElementById('dieuHanhDropdownPanel')?.classList.toggle('hidden');
}
function closeDieuHanhDropdown() {
  document.getElementById('dieuHanhDropdownPanel')?.classList.add('hidden');
}
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('dieuHanhDropdownPanel');
  const btn = document.getElementById('btnDieuHanhTab');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(ev.target) && ev.target !== btn && !btn?.contains(ev.target)) panel.classList.add('hidden');
});

// "Hành Chính" — cùng khuôn Điều Hành, bọc Phòng họp/Đăng ký xe/Văn phòng phẩm (xem HTML #hanhChinhNavWrap).
function updateHanhChinhNavVisibility() {
  const meetingVisible = !document.getElementById('btnMeetingTab').classList.contains('hidden');
  const carVisible = !document.getElementById('btnCarTab').classList.contains('hidden');
  const vppVisible = !document.getElementById('btnVppTab').classList.contains('hidden');
  const uniformVisible = !document.getElementById('btnUniformTab').classList.contains('hidden');
  const licenseVisible = !document.getElementById('btnLicenseTab').classList.contains('hidden');
  document.getElementById('hanhChinhNavWrap').classList.toggle('hidden', !meetingVisible && !carVisible && !vppVisible && !uniformVisible && !licenseVisible);
}
function toggleHanhChinhDropdown(e) {
  e.stopPropagation();
  document.getElementById('hanhChinhDropdownPanel')?.classList.toggle('hidden');
}
function closeHanhChinhDropdown() {
  document.getElementById('hanhChinhDropdownPanel')?.classList.add('hidden');
}
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('hanhChinhDropdownPanel');
  const btn = document.getElementById('btnHanhChinhTab');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(ev.target) && ev.target !== btn && !btn?.contains(ev.target)) panel.classList.add('hidden');
});

// Thanh tab điều hướng nhanh trong trang cho nhóm Điều Hành (Biên bản họp/Công việc/Báo Cáo Định Kỳ) và
// Hành Chính (Phòng họp/Đăng ký xe/Văn phòng phẩm) — khác Hợp Đồng/Tổng Hợp/Hệ Thống (nơi các "tab con"
// chỉ là lọc khác nhau trên CÙNG 1 danh sách), 3 module trong mỗi nhóm này là dữ liệu HOÀN TOÀN độc lập
// (bảng riêng, form riêng), nên thanh này CHỈ điều hướng chéo (gọi switchTab() sang module anh em) chứ
// không lọc/gộp dữ liệu — tránh phải bấm lại vào dropdown ở sidebar mỗi lần muốn đổi module trong nhóm.
// Ẩn cả thanh nếu người dùng chỉ thấy được ≤1 module trong nhóm (không có gì để điều hướng chéo).
// containerId của mỗi module tự ghép "<nhóm>TabBar_<tab>" (vd "dieuHanhTabBar_task") — PHẢI đặt riêng
// từng section (không dùng chung 1 id) vì cả 3 section trong nhóm cùng tồn tại trong DOM một lúc (chỉ
// ẩn/hiện bằng class "hidden"), dùng chung id sẽ vi phạm id trùng lặp toàn trang.
const CROSS_TAB_GROUPS = {
  dieuHanh: [
    { tab: 'minutes', label: '📝 Biên bản họp', canAccess: canAccessMeetingMinutesModule },
    { tab: 'task', label: '📋 Công việc', canAccess: canAccessTaskModule },
    { tab: 'periodicReport', label: '📅 Báo Cáo Định Kỳ', canAccess: canAccessPeriodicReportModule }
  ],
  hanhChinh: [
    { tab: 'meeting', label: '📅 Phòng họp', canAccess: canAccessMeetingModule },
    { tab: 'car', label: '🚗 Đăng ký xe', canAccess: canAccessCarModule },
    { tab: 'vpp', label: '🖇️ Văn phòng phẩm', canAccess: canAccessVppModule },
    { tab: 'uniform', label: '👕 Đồng phục', canAccess: canAccessUniformModule }
  ]
};
function renderCrossTabBar(groupKey, activeTab) {
  const container = document.getElementById(`${groupKey}TabBar_${activeTab}`);
  if (!container) return;
  const items = CROSS_TAB_GROUPS[groupKey].filter(t => t.canAccess(currentUser));
  if (items.length <= 1) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  const activeCls = 'px-3 py-1 rounded text-xs font-bold bg-slate-700 text-white';
  const inactiveCls = 'px-3 py-1 rounded text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200';
  container.innerHTML = items.map(t =>
    `<button type="button" data-op="switchTab" data-arg0="${escapeHtml(t.tab)}" class="${t.tab === activeTab ? activeCls : inactiveCls}">${t.label}</button>`
  ).join('');
}

// "Tổng Hợp" — cùng khuôn Điều Hành/Hành Chính, bọc Mua Bán/Sửa Chữa/Đầu Tư/Thanh Toán (module "office",
// xem HTML #tongHopNavWrap). "Hợp Đồng" (#hopDongNavWrap) là dropdown NGANG HÀNG riêng biệt — 2 module
// độc lập, không lồng vào nhau.
function updateTongHopNavVisibility() {
  const buyVisible = !document.getElementById('btnOfficeSubBuyNav').classList.contains('hidden');
  const fixVisible = !document.getElementById('btnOfficeSubFixNav').classList.contains('hidden');
  const paymentVisible = !document.getElementById('btnOfficeSubPaymentNav').classList.contains('hidden');
  const budgetVisible = !document.getElementById('btnBudgetNav').classList.contains('hidden');
  document.getElementById('tongHopNavWrap').classList.toggle('hidden', !buyVisible && !fixVisible && !paymentVisible && !budgetVisible);
}
function toggleTongHopDropdown(e) {
  e.stopPropagation();
  document.getElementById('tongHopDropdownPanel')?.classList.toggle('hidden');
}
function closeTongHopDropdown() {
  document.getElementById('tongHopDropdownPanel')?.classList.add('hidden');
}
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('tongHopDropdownPanel');
  const btn = document.getElementById('btnTongHopTab');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(ev.target) && ev.target !== btn && !btn?.contains(ev.target)) panel.classList.add('hidden');
});

// "Vận Hành" — cùng khuôn "Tổng Hợp" ở trên, bọc 3 luồng ĐỘC LẬP Phê Duyệt Đơn Hàng/Mở Mới Siêu Thị/
// Sửa Chữa Siêu Thị (module "vanHanh", xem HTML #vanHanhNavWrap). LƯU Ý ĐẶT TÊN: KHÔNG dùng tiền tố
// "dieuHanh" (module "Điều Hành" — Biên Bản Họp/Công Việc/Báo Cáo Định Kỳ — đã tồn tại sẵn, dễ nhầm lẫn
// khi đọc code vì phát âm gần giống "Vận Hành").
function updateVanHanhNavVisibility() {
  const orderVisible = !document.getElementById('btnOperationOrderNav').classList.contains('hidden');
  const storeVisible = !document.getElementById('btnOperationStoreNav').classList.contains('hidden');
  document.getElementById('vanHanhNavWrap').classList.toggle('hidden', !orderVisible && !storeVisible);
}
function toggleVanHanhDropdown(e) {
  e.stopPropagation();
  document.getElementById('vanHanhDropdownPanel')?.classList.toggle('hidden');
}
function closeVanHanhDropdown() {
  document.getElementById('vanHanhDropdownPanel')?.classList.add('hidden');
}
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('vanHanhDropdownPanel');
  const btn = document.getElementById('btnVanHanhTab');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(ev.target) && ev.target !== btn && !btn?.contains(ev.target)) panel.classList.add('hidden');
});

// "Nhân Sự" — cùng khuôn "Vận Hành"/"Tổng Hợp" ở trên, bọc "Quản Lý & Phản Hồi Ý Kiến" (module "hr")
// và module con "Cơ Cấu Tổ Chức" (module "orgChart", parent:'hr' ở BUSINESS_MODULES, xem HTML
// #hrNavWrap). Chỗ trống sẵn để nối thêm module con thật (Onboarding/Offboarding/Hồ Sơ Nhân Sự/KPI/
// Công & Phép...) sau này — chỉ cần thêm 1 entry BUSINESS_MODULES (parent:'hr') + 1 nút trong
// #hrDropdownPanel + 1 dòng toggle-hidden ở finishLogin(), đúng khuôn budget/vanHanh, không phải dựng
// lại cơ chế dropdown.
function updateHrNavVisibility() {
  const feedbackVisible = !document.getElementById('btnHrFeedbackNav').classList.contains('hidden');
  const orgChartVisible = !document.getElementById('btnOrgChartNav').classList.contains('hidden');
  document.getElementById('hrNavWrap').classList.toggle('hidden', !feedbackVisible && !orgChartVisible);
}
function toggleHrDropdown(e) {
  e.stopPropagation();
  document.getElementById('hrDropdownPanel')?.classList.toggle('hidden');
}
function closeHrDropdown() {
  document.getElementById('hrDropdownPanel')?.classList.add('hidden');
}
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('hrDropdownPanel');
  const btn = document.getElementById('btnHrTab');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(ev.target) && ev.target !== btn && !btn?.contains(ev.target)) panel.classList.add('hidden');
});

// "Hợp Đồng" — cùng khuôn Điều Hành/Hành Chính, bọc 2 sub-tab Phê Duyệt/Quản Lý HĐ & Giấy Phép (module
// "contract", xem HTML #hopDongNavWrap). Không có hàm updateXNavVisibility riêng như Điều Hành/Hành
// Chính/Tổng Hợp vì 2 sub-tab này dùng CHUNG 1 điều kiện quyền (canAccessContractModule — không có
// phân quyền riêng theo từng sub-tab) — nút cha ẩn/hiện thẳng theo đúng điều kiện đó ở finishLogin().
function toggleHopDongDropdown(e) {
  e.stopPropagation();
  document.getElementById('hopDongDropdownPanel')?.classList.toggle('hidden');
}
function closeHopDongDropdown() {
  document.getElementById('hopDongDropdownPanel')?.classList.add('hidden');
}
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('hopDongDropdownPanel');
  const btn = document.getElementById('btnHopDongTab');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(ev.target) && ev.target !== btn && !btn?.contains(ev.target)) panel.classList.add('hidden');
});

// "Hỗ Trợ IT" — cùng khuôn Hợp Đồng ở trên: bọc 2 sub-tab Phê Duyệt Giá/Hỗ Trợ Yêu Cầu (module
// "itSupport", xem HTML #itSupportNavWrap). Không có hàm updateXNavVisibility riêng vì 2 sub-tab dùng
// CHUNG 1 điều kiện quyền canAccessItSupportModule — nút cha ẩn/hiện thẳng theo đúng điều kiện đó ở
// finishLogin().
function toggleItSupportDropdown(e) {
  e.stopPropagation();
  document.getElementById('itSupportDropdownPanel')?.classList.toggle('hidden');
}
function closeItSupportDropdown() {
  document.getElementById('itSupportDropdownPanel')?.classList.add('hidden');
}
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('itSupportDropdownPanel');
  const btn = document.getElementById('btnItSupportTab');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(ev.target) && ev.target !== btn && !btn?.contains(ev.target)) panel.classList.add('hidden');
});

// "Truyền Thông" — cùng khuôn Hợp Đồng, bọc 4 loại bài Nhịp Sống HCRC/Đào Tạo/Khen Thưởng/Góc Chia Sẻ
// (module "internal", xem HTML #truyenThongNavWrap). Không có hàm updateXNavVisibility riêng vì cả 4
// loại dùng CHUNG 1 điều kiện quyền XEM (canAccessInternalModule) — nút cha ẩn/hiện thẳng theo đúng
// điều kiện đó ở finishLogin().
function toggleTruyenThongDropdown(e) {
  e.stopPropagation();
  document.getElementById('truyenThongDropdownPanel')?.classList.toggle('hidden');
}
function closeTruyenThongDropdown() {
  document.getElementById('truyenThongDropdownPanel')?.classList.add('hidden');
}
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('truyenThongDropdownPanel');
  const btn = document.getElementById('btnInternalTab');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(ev.target) && ev.target !== btn && !btn?.contains(ev.target)) panel.classList.add('hidden');
});

// "Hệ Thống" — cùng khuôn Hợp Đồng, bọc 4 mục con Quản Trị/Biểu Mẫu/Quy Trình & Phê Duyệt/Log (module
// "system", xem HTML #heThongNavWrap). Không có hàm updateXNavVisibility riêng vì cả 4 mục đều yêu cầu
// admin (setSystemSubTab() tự chặn !admin ở đầu hàm, không có quyền riêng từng mục) — nút cha ẩn/hiện
// thẳng theo user.perms.admin ở finishLogin().
function toggleHeThongDropdown(e) {
  e.stopPropagation();
  document.getElementById('heThongDropdownPanel')?.classList.toggle('hidden');
}
function closeHeThongDropdown() {
  document.getElementById('heThongDropdownPanel')?.classList.add('hidden');
}
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('heThongDropdownPanel');
  const btn = document.getElementById('btnSystemTab');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(ev.target) && ev.target !== btn && !btn?.contains(ev.target)) panel.classList.add('hidden');
});

// setActiveSidebarTab(tabName) — tô sáng đúng (các) nút sidebar trái tương ứng module vừa chuyển tới,
// gọi DUY NHẤT 1 chỗ ngay trong switchTab() (xem cuối hàm) nên tự động khớp với MỌI cách gọi
// switchTab() có sẵn khắp trang, không cần sửa từng onclick="switchTab(...)". KHÔNG dò/đổi state của 17
// hàm setXSubTab() (tab con NẰM BÊN TRONG 1 module, vd setInternalSubTab()) — các hàm đó đã tự tô sáng
// đúng nút con của riêng chúng rồi, hàm này chỉ lo đúng 1 việc: cấp sidebar ngoài cùng (mục cấp 1 đứng
// riêng lẻ NHƯ btnDocTab, hoặc mục con NẰM TRONG 1 nhóm dropdown NHƯ btnMinutesTab trong Điều Hành).
//
// Cách xác định nút nào khớp: quét toàn bộ nút `.sidebar-item`/`.sidebar-subitem` trong <nav>, so khớp
// thẳng với chuỗi "switchTab('<tabName>')" có trong thuộc tính onclick của từng nút — KHÔNG cần thêm
// id/data-* riêng cho từng nút (nhiều nút mục con hiện chưa có id, vd 4 nút trong "Truyền thông"), tự
// động khớp cả những nút thêm mới sau này miễn onclick vẫn gọi switchTab(tabName) như khuôn hiện có.
// Với 1 tabName dùng CHUNG cho nhiều nút con cùng 1 nhóm (vd 4 nút trong "Tổng Hợp" đều gọi
// switchTab('office'), chỉ khác setOfficeSubTab() đứng sau — switchTab() không nhận được tham số đó nên
// không thể phân biệt tiếp) thì cả nhóm cùng được tô sáng — chấp nhận được, vẫn đúng hướng "đang ở module
// nào", không thay thế việc setOfficeSubTab() tự tô sáng đúng tab con bên TRONG module.
function setActiveSidebarTab(tabName) {
  const nav = document.querySelector('#userHeader nav');
  if (!nav) return;

  nav.querySelectorAll('.sidebar-item-active, .sidebar-subitem-active').forEach(el => {
    el.classList.remove('sidebar-item-active', 'sidebar-subitem-active');
  });
  if (!tabName) return;

  const marker = `switchTab('${tabName}')`;
  nav.querySelectorAll('.sidebar-item, .sidebar-subitem').forEach(el => {
    if (!(el.getAttribute('onclick') || '').includes(marker)) return;
    el.classList.add(el.classList.contains('sidebar-subitem') ? 'sidebar-subitem-active' : 'sidebar-item-active');
    // Mục con thuộc 1 nhóm dropdown (…NavWrap) → tô sáng LUÔN nút đầu nhóm để biết đang mở nhóm nào.
    const navWrap = el.closest('[id$="NavWrap"]');
    const header = navWrap ? navWrap.querySelector(':scope > .sidebar-item') : null;
    if (header) header.classList.add('sidebar-item-active');
  });
}

async function switchTab(tabName) {
  if (!currentUser) return logout();
  closeMobileSidebar(); // Đóng sidebar off-canvas trên điện thoại mỗi khi chuyển màn hình (không ảnh hưởng desktop).

  if (tabName === 'approvalHub' && !canAccessApprovalHub(currentUser)) {
    alert('⛔ Bạn không nằm trong luồng phê duyệt của bất kỳ hồ sơ nào.');
    return;
  }
  if (tabName === 'doc' && !canAccessDocModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Tài liệu!');
    return;
  }
  if (tabName === 'task' && !canAccessTaskModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Công việc!');
    return;
  }
  if (tabName === 'internal' && !canAccessInternalModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Truyền thông nội bộ!');
    return;
  }
  if (tabName === 'submission' && !canAccessSubmissionModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Xử lý Văn bản trình!');
    return;
  }
  if (tabName === 'contract' && !canAccessContractModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Hợp đồng & giấy phép!');
    return;
  }
  if (tabName === 'meeting' && !canAccessMeetingModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Quản lý phòng họp!');
    return;
  }
  if (tabName === 'minutes' && !canAccessMeetingMinutesModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Biên bản họp!');
    return;
  }
  if (tabName === 'car' && !canAccessCarModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Đăng ký xe!');
    return;
  }
  if (tabName === 'vpp' && !canAccessVppModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Văn phòng phẩm!');
    return;
  }
  if (tabName === 'uniform' && !canAccessUniformModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Đồng phục!');
    return;
  }
  if (tabName === 'license' && !canAccessLicenseModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Giấy phép!');
    return;
  }
  if (tabName === 'periodicReport' && !canAccessPeriodicReportModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Báo Cáo Định Kỳ!');
    return;
  }
  // "office" còn chứa sub-tab Thanh Toán (quyền RIÊNG canAccessPaymentModule(), không dùng
  // officeBuy/Fix/Invest như canAccessOfficeModule() — xem chú thích tại canAccessPaymentModule()) —
  // trước đây chỉ xét canAccessOfficeModule() nên người CHỈ có paymentManage (vd kế toán, không có
  // quyền tạo đề nghị Mua Bán/Sửa Chữa/Đầu Tư nào) thấy đúng nút "💰 Thanh Toán" ở sidebar (tự ẩn/hiện
  // theo canAccessPaymentModule() riêng) nhưng bấm vào lại bị chặn ngay tại đây, không vào được.
  if (tabName === 'office' && !canAccessOfficeModule(currentUser) && !canAccessPaymentModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Tổng Hợp!');
    return;
  }
  if (tabName === 'reports' && !canAccessReportsModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Báo cáo!');
    return;
  }
  if (tabName === 'hr' && !canAccessHrModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Nhân Sự!');
    return;
  }
  if (tabName === 'orgChart' && !canAccessOrgChartModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Cơ Cấu Tổ Chức!');
    return;
  }
  if (tabName === 'budget' && !canAccessBudgetModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Ngân Sách!');
    return;
  }
  if (tabName === 'vanHanh' && !canAccessOperationModule(currentUser)) {
    alert('⛔ Bạn không có quyền truy cập Module Vận Hành!');
    return;
  }

  setActiveSidebarTab(tabName); // Tô sáng đúng nút sidebar trái vừa chuyển tới — xem chú thích hàm.

  // Cuộn về đầu trang mỗi khi đổi MODULE — cùng lý do như setSystemSubTab()/các setXXXSubTab() khác:
  // tránh giữ nguyên vị trí cuộn cũ (đang ở giữa/cuối 1 màn dài) khi module mới ngắn hơn nhiều, trình
  // duyệt tự kẹp cuộn xuống gần cuối màn mới trông như tự "bay xuống cuối".
  window.scrollTo({ top: 0, behavior: 'auto' });

  document.getElementById('dashboardSection').classList.toggle('hidden', tabName !== 'dashboard');
  document.getElementById('approvalHubSection').classList.toggle('hidden', tabName !== 'approvalHub');
  document.getElementById('docSection').classList.toggle('hidden', tabName !== 'doc');
  document.getElementById('submissionSection').classList.toggle('hidden', tabName !== 'submission');
  document.getElementById('taskSection').classList.toggle('hidden', tabName !== 'task');
  document.getElementById('contractSection').classList.toggle('hidden', tabName !== 'contract');
  document.getElementById('meetingSection').classList.toggle('hidden', tabName !== 'meeting');
  document.getElementById('minutesSection').classList.toggle('hidden', tabName !== 'minutes');
  document.getElementById('internalSection').classList.toggle('hidden', tabName !== 'internal');
  document.getElementById('carSection').classList.toggle('hidden', tabName !== 'car');
  document.getElementById('vppSection').classList.toggle('hidden', tabName !== 'vpp');
  document.getElementById('uniformSection').classList.toggle('hidden', tabName !== 'uniform');
  document.getElementById('licenseSection').classList.toggle('hidden', tabName !== 'license');
  document.getElementById('periodicReportSection').classList.toggle('hidden', tabName !== 'periodicReport');
  document.getElementById('officeSection').classList.toggle('hidden', tabName !== 'office');
  document.getElementById('systemSection').classList.toggle('hidden', tabName !== 'system');
  document.getElementById('formSection').classList.toggle('hidden', !(tabName === 'system' && activeSystemSubTab === 'FORM'));
  document.getElementById('adminSection').classList.toggle('hidden', !(tabName === 'system' && activeSystemSubTab === 'ADMIN'));
  document.getElementById('workflowSection').classList.toggle('hidden', !(tabName === 'system' && activeSystemSubTab === 'WORKFLOW'));
  document.getElementById('logSection').classList.toggle('hidden', !(tabName === 'system' && activeSystemSubTab === 'LOG'));
  document.getElementById('reportsSection').classList.toggle('hidden', tabName !== 'reports');
  document.getElementById('itSupportSection').classList.toggle('hidden', tabName !== 'itSupport');
  document.getElementById('budgetSection').classList.toggle('hidden', tabName !== 'budget');
  document.getElementById('vanHanhSection').classList.toggle('hidden', tabName !== 'vanHanh');
  document.getElementById('hrSection').classList.toggle('hidden', tabName !== 'hr');
  document.getElementById('orgChartSection').classList.toggle('hidden', tabName !== 'orgChart');

  populateDropdowns();
  updateApprovalHubBadge();
  if (['minutes', 'task', 'periodicReport'].includes(tabName)) renderCrossTabBar('dieuHanh', tabName);
  if (['meeting', 'car', 'vpp', 'uniform', 'license'].includes(tabName)) renderCrossTabBar('hanhChinh', tabName);

  // Ha tang: nap module theo cum, dot 7 — file(s) module-*.js cua tab nay (neu co, xem TAB_MODULE_GROUPS
  // dau file) co the CHUA nap (lan dau vao tab trong phien nay) — doi nap xong TRUOC KHI goi ham render/
  // setXSubTab tuong ung o _dispatchTabRender(), tranh ReferenceError. Khong chan phan hien/an section o
  // TREN (da chay xong, dong bo) — chi phan render THAT SU can file module bi hoan lai vai chuc mili-giay
  // o lan dau. isTabModuleGroupsSettled() cho phep NHANH DONG BO (khong lui 1 nhip vi mo/microtask nao)
  // khi tab nay (va cum cua no) DA tung mo trong phien — giu dung hanh vi dong bo y het truoc Ha tang nay,
  // tranh 1 lop bug tinh vi: code goi switchTab(x) roi DOC LAI DOM ngay dong bo sau do (khong await) —
  // nếu luon buoc qua await du chi 1 nhip, phan render se chay CHAM hon code doc sau, doc phai DOM CU
  // (phat hien qua bo test hoi quy — xem VERSION.md).
  if (isTabModuleGroupsSettled(tabName)) {
    _dispatchTabRender(tabName);
    return;
  }
  try {
    await loadTabModuleGroups(tabName);
  } catch (err) {
    console.error('switchTab: không tải được mô-đun cho tab', tabName, err);
    alert('⛔ Không tải được nội dung mô-đun. Vui lòng kiểm tra kết nối mạng và thử lại.');
    return;
  }
  _dispatchTabRender(tabName);
}

function _dispatchTabRender(tabName) {
  if (tabName === 'dashboard') { renderDashboard(); }
  if (tabName === 'approvalHub') { renderApprovalHub(); }
  if (tabName === 'doc') {
    renderDynamicInputsForModule('DOC', 'dynamicFieldsContainer_DOC'); renderDocs(); updateUploadDeptDropdown();
    document.getElementById('docOpMode').value = 'NEW';
    onDocOpModeChange();
  }
  if (tabName === 'submission') { renderDynamicInputsForModule('SUBMISSION', 'dynamicFieldsContainer_SUBMISSION'); renderSubmissionApprovalLayerCheckboxes(); renderSubmissionReqs(); document.getElementById('subCode').value = generateSubCode(); }
  if (tabName === 'task') {
    document.getElementById('btnManualTaskCreate').classList.toggle('hidden', !canManageTasks(currentUser));
    renderTasks();
  }
  if (tabName === 'contract') { setContractSubTab(activeContractSubTab); }
  if (tabName === 'meeting') { renderDynamicInputsForModule('MEETING_ROOM', 'dynamicFieldsContainer_MEETING_ROOM'); renderMeetings(); setMeetingSubTab(activeMeetingSubTab); document.getElementById('meetingCode').value = generateMeetingCode(); }
  if (tabName === 'minutes') {
    renderDynamicInputsForModule('MEETING_MINUTES', 'dynamicFieldsContainer_MEETING_MINUTES');
    renderMeetingMinutes();
    populateMinutesLinkSelect();
    renderMeetingAttendeeTemplateSelect();
    const canCreate = canCreateMeetingMinutes(currentUser);
    document.getElementById('minutesForm').classList.toggle('hidden', !canCreate);
    document.getElementById('minutesNoPermNote').classList.toggle('hidden', canCreate);
    if (editingMinutesId === null) document.getElementById('minutesCode').value = generateMinutesCode();
  }
  if (tabName === 'internal') { setInternalSubTab(activeInternalSubTab); }
  if (tabName === 'car') { setCarSubTab(activeCarSubTab); }
  if (tabName === 'vpp') { setVppSubTab(activeVppSubTab); }
  if (tabName === 'uniform') { setUniformSubTab(activeUniformSubTab); }
  if (tabName === 'license') { renderLicenses(); document.getElementById('licenseOpMode').value = 'NEW'; onLicenseOpModeChange(); }
  if (tabName === 'periodicReport') { setPeriodicReportSubTab(activePeriodicReportSubTab); }
  if (tabName === 'office') {
    let targetSub = activeOfficeSubTab;
    if (!canAccessOfficeSubTab(currentUser, targetSub)) {
      if (canAccessOfficeSubTab(currentUser, 'MUA_BAN')) targetSub = 'MUA_BAN';
      else if (canAccessOfficeSubTab(currentUser, 'SUA_CHUA')) targetSub = 'SUA_CHUA';
    }
    setOfficeSubTab(targetSub);
  }
  if (tabName === 'system' && currentUser.perms.admin) { setSystemSubTab(activeSystemSubTab); }
  if (tabName === 'reports' && canAccessReportsModule(currentUser)) { renderReports(); }
  if (tabName === 'itSupport') { setItSupportSubTab(activeItSupportSubTab); }
  if (tabName === 'budget') { setBudgetSubTab(activeBudgetSubTab); }
  if (tabName === 'vanHanh') { setVanHanhSubTab(activeVanHanhSubTab); }
  if (tabName === 'hr') { renderHrFeedbackManage(); }
  if (tabName === 'orgChart') { renderOrgChart(); }
}

// Quyền vào sub-tab "💰 Thanh Toán" của Tổng Hợp — khác hẳn canAccessOfficeSubTab() (không có khái
// niệm officeBuy/Fix/Invest), chỉ cần paymentManage/admin.
function canAccessPaymentModule(user) {
  return !!(user?.perms?.admin || user?.perms?.paymentManage);
}

// canManagePaymentRequestsClient() - CHUYEN tu module-thanhtoan.js sang day (Ha tang: nap module theo
// cum, dot 7) - getMyPendingApprovals() (core-approvalhub.js, luon nap san) goi thang ham nay o MOI
// switchTab(), khong the de nam o 1 file module-*.js duoc nap luoi. Cung dieu kien voi
// canAccessPaymentModule() ngay tren nhung giu ten rieng (dung o ngu canh khac trong code cu, khong doi
// de tranh anh huong noi khac dang goi dung ten nay).
function canManagePaymentRequestsClient(user) {
  return !!(user?.perms?.admin || user?.perms?.paymentManage);
}

// canAggregateReportsClient() - CHUYEN tu module-baocaodinhky-nhap.js sang day (Ha tang: nap module theo
// cum, dot 7) - buildDashboardCards() (core-dashboard.js, luon nap san) goi thang ham nay o MOI lan mo
// trang chu (khong the de nam o 1 file module-*.js duoc nap luoi).
function canAggregateReportsClient(user) {
  return !!(user?.perms?.admin || user?.perms?.reportAggregate);
}

// isInternalPostScheduled() - CHUYEN tu module-internalcomms-nhipsong.js sang day (Ha tang: nap module
// theo cum, dot 7) - renderDashboardNews() (core-dashboard.js, luon nap san) goi thang ham nay o MOI lan
// mo trang chu.
function isInternalPostScheduled(p) {
  return p.type === 'NEWS' && p.status === 'APPROVED' && !!p.publishAt && new Date(p.publishAt).getTime() > Date.now();
}

// Ngân Sách — module con của "Tổng Hợp" (BUSINESS_MODULES parent:'office'). Phải có ÍT NHẤT 1 trong 3
// quyền chi tiết (budgetCreate/budgetAggregate/budgetManage) mới vào được module — KHÔNG có "quyền mặc
// định xem miễn phí" chỉ nhờ còn quyền vào module (mục 0), đúng khuôn canAccessOfficeModule() (đòi
// officeBuy/Fix/Invest). 3 quyền phân theo phạm vi xem được:
// - budgetCreate ("xem, tạo ngân sách"): xem/nhập/sửa ngân sách Phê Duyệt & Thực Hiện của ĐÚNG phòng ban
//   mình (server đã ép forceOwnDept — xem lib/createValidation.js), CỘNG thêm xem được tab Tổng Hợp
//   nhưng CHỈ thấy đúng phòng mình (dữ liệu DB.budgetEntries đồng bộ về máy vốn đã lọc theo
//   canViewBudgetEntry() — item.dept === user.dept — nên không cần lọc thêm phía client).
// - budgetAggregate ("tổng hợp"): thêm tab Tổng Hợp — phần "Theo Phòng Ban" MỌI phòng ban + "Chi Tiết
//   Theo Hạng Mục", KHÔNG thấy số liệu gộp toàn công ty.
// - budgetManage ("quản lý ngân sách"): xem được HẾT các phòng ban khác (như budgetAggregate) + xem thêm
//   khối "Toàn Công Ty" trong Tổng Hợp + toàn quyền quản trị kỳ/mẫu — nhưng KHÔNG sửa được ngân sách của
//   phòng ban khác (server chặn cứng ở updateBudgetEntryDraft()/submitBudgetEntry(): item.dept !==
//   user.dept -> 403, admin mới bỏ qua được, xem lib/recordActions.js).
// Xem canManageBudgetClient()/canCreateBudgetEntryClient()/canAggregateBudgetClient() bên dưới.
function canAccessBudgetModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (!hasModuleAccess(user, 'budget')) return false;
  return !!(user.perms?.budgetCreate || user.perms?.budgetAggregate || user.perms?.budgetManage);
}

// Nhân Sự — module TOP-LEVEL (không có module cha), cùng khuôn canAccessBudgetModule() ở trên. "Cơ Cấu
// Tổ Chức" đã TÁCH thành module con riêng (parent:'hr', xem canAccessOrgChartModule() ngay dưới đây +
// BUSINESS_MODULES) — module "hr" giờ quay lại đúng 1 quyền chi tiết DUY NHẤT (nhanSuManage), gác luôn
// tab "Quản Lý & Phản Hồi Ý Kiến" (module chỉ có 1 tab, không cần canAccessHrSubTab() riêng nữa). Lưu ý:
// tab "HCRC Đồng Hành" bên Truyền Thông (nơi nhân viên GỬI câu hỏi) KHÔNG dùng hàm này — mở cho mọi người.
function canAccessHrModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (!hasModuleAccess(user, 'hr')) return false;
  return !!user.perms?.nhanSuManage;
}
// Cơ Cấu Tổ Chức — module con của "Nhân Sự" (parent:'hr' ở BUSINESS_MODULES) — hasModuleAccess() tự
// khoá module con này nếu module cha "hr" bị tắt ở "0. Quyền Truy Cập Module", bất kể checkbox riêng
// của "orgChart" đang bật hay tắt (xem chú thích hasModuleAccess()). Quyền vào: orgChartManage HOẶC
// nhanSuManage — giữ nguyên 2 quyền cũ từng gác chung 1 tab con trước đợt tách (ai đang thấy được vẫn
// thấy được y hệt, không siết/nới quyền của ai).
function canAccessOrgChartModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (!hasModuleAccess(user, 'orgChart')) return false;
  return !!(user.perms?.orgChartManage || user.perms?.nhanSuManage);
}

// isManagerOf()/workItemAssignees()/isWorkItemAssignee() — CHUYỂN từ module-hcrcdonghanh.js sang đây
// (Hạ tầng: nạp module theo cụm, đợt 7 — tách JS thành cụm nạp lười theo tab). canAccessOperationModule()/
// canAccessOperationSubTab() ngay dưới đây gọi thẳng 3 hàm này để tính hiện/ẩn nav "Vận Hành"
// (updateVanHanhNavVisibility(), gọi từ finishLogin() NGAY SAU đăng nhập) — TRƯỚC KHI người dùng mở bất
// kỳ tab nào, nên bắt buộc phải có sẵn ngay từ đầu, không thể nằm ở 1 file module-*.js được nạp lười khi
// mở tab (module-hcrcdonghanh.js chỉ nạp khi vào tab "Nhân Sự"). 3 hàm này tự thân không phụ thuộc gì
// khác trong module-hcrcdonghanh.js (chỉ dùng DB.users/tham số truyền vào) nên chuyển nguyên vẹn, không
// đổi 1 dòng logic.
function isManagerOf(managerUsername, targetUsername, allUsers) {
  if (!managerUsername || !targetUsername) return false;
  let cur = (allUsers || []).find(u => u.username === targetUsername);
  for (let i = 0; i < 50 && cur?.managerUsername; i++) {
    if (cur.managerUsername === managerUsername) return true;
    cur = (allUsers || []).find(u => u.username === cur.managerUsername);
  }
  return false;
}
// workItemAssignees()/isWorkItemAssignee() (Mục E, Vận Hành > Siêu Thị > Thực hiện) — mirror ĐÚNG bản
// server ở lib/recordActions.js (không import chung được giữa 2 phía, xem ghi chú ở đó). assignedTo giờ
// là string[]|null (trước đây string|null) — workItemAssignees() tự tương thích ngược với dữ liệu CŨ.
function workItemAssignees(w) {
  const a = w?.assignedTo;
  return Array.isArray(a) ? a.filter(Boolean) : (a ? [a] : []);
}
function isWorkItemAssignee(w, username) {
  return !!username && workItemAssignees(w).includes(username);
}

// Vận Hành — module TOP-LEVEL mới, 3 luồng ĐỘC LẬP (operationOrders/operationStoreOpenings/
// operationRepairs, KHÔNG chung dữ liệu officeReqs của "Tổng Hợp"). Phải có ÍT NHẤT 1 trong 3 quyền tạo
// mới vào được module — đúng khuôn canAccessOfficeModule()/canAccessBudgetModule(). Mỗi luồng gate riêng
// bằng đúng 1 quyền tạo tương ứng — xem canCreateOperationOrderClient()/
// canCreateOperationStoreOpeningClient()/canCreateOperationRepairClient() bên dưới, và
// canAccessOperationSubTab() cho việc chuyển tab con.
function canAccessOperationModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (!hasModuleAccess(user, 'vanHanh')) return false;
  if (user.perms?.operationOrderCreate || user.perms?.operationStoreOpenCreate || user.perms?.operationRepairCreate
    || user.perms?.operationEstimateCreate || user.perms?.operationExecutionManage || user.perms?.operationAcceptanceManage) return true;
  // Người được gán/chỉ định trực tiếp trên ít nhất 1 công việc (dù không giữ quyền rộng nào ở trên)
  // cũng cần vào được module để thao tác đúng việc của mình — khớp nhánh nới quyền ở
  // canAccessOperationSubTab() (EXECUTION/ACCEPTANCE) bên dưới. Trưởng phòng (đệ quy theo Cơ Cấu Tổ
  // Chức) của người được gán/chỉ định cũng vào được để XEM (không thao tác được, các hàm thao tác
  // không đổi).
  return (DB.operationWorkItems || []).some(w => isWorkItemAssignee(w, user.username) || w.acceptorUsername === user.username
    || workItemAssignees(w).some(u => isManagerOf(user.username, u, DB.users)) || isManagerOf(user.username, w.acceptorUsername, DB.users));
}
function canAccessOperationSubTab(user, kind) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (kind === 'ORDER') return !!user.perms?.operationOrderCreate;
  if (kind === 'STORE_OPEN') return !!user.perms?.operationStoreOpenCreate;
  if (kind === 'REPAIR') return !!user.perms?.operationRepairCreate;
  if (kind === 'ESTIMATE') return !!user.perms?.operationEstimateCreate;
  // EXECUTION/ACCEPTANCE: "toàn quyền" (operationExecutionManage/operationAcceptanceManage) thấy hết;
  // NGOÀI RA người được gán/chỉ định trực tiếp trên ít nhất 1 công việc (dù không có quyền rộng) cũng
  // cần thấy tab để còn thao tác đúng việc của mình (xem updateOperationWorkItemProgress/
  // acceptOperationWorkItem ở lib/recordActions.js — server đã chặn/nới quyền tương ứng).
  if (kind === 'EXECUTION') return !!user.perms?.operationExecutionManage
    || (DB.operationWorkItems || []).some(w => isWorkItemAssignee(w, user.username) || workItemAssignees(w).some(u => isManagerOf(user.username, u, DB.users)));
  if (kind === 'ACCEPTANCE') return !!user.perms?.operationAcceptanceManage
    || (DB.operationWorkItems || []).some(w => w.acceptorUsername === user.username || isManagerOf(user.username, w.acceptorUsername, DB.users));
  // 'STORE'/'REPORT': tab cha "Siêu Thị" — hiện khi có BẤT KỲ quyền nào trong 5 giai đoạn con.
  if (kind === 'STORE' || kind === 'REPORT') {
    return ['STORE_OPEN', 'REPAIR', 'ESTIMATE', 'EXECUTION', 'ACCEPTANCE'].some(k => canAccessOperationSubTab(user, k));
  }
  return false;
}

// activeOperationStoreSubTab — CHUYỂN từ module-vanhanh.js sang đây (Hạ tầng: nạp module theo cụm, đợt
// 7): updateOperationStoreSubTabVisibility() ngay dưới đây đọc/ghi biến này, gọi từ finishLogin() NGAY
// SAU đăng nhập — TRƯỚC KHI người dùng mở tab "Vận Hành" — nên không thể để khai báo nằm ở module-vanhanh.js
// (chỉ nạp lười khi vào tab đó). setOperationStoreSubTab()/switchSubTab (module-vanhanh.js) vẫn đọc/ghi
// đúng biến toàn cục này bình thường (biến top-level dùng chung mọi <script> cổ điển trên trang).
let activeOperationStoreSubTab = 'OPEN';

// Ẩn/hiện từng nút sub-tab cấp 2 bên trong "🏬 Siêu Thị" theo đúng quyền (khác cấp 1 chỉ cần 1 quyền
// bất kỳ để hiện tab cha) — nếu tab đang active bị ẩn, tự chuyển sang tab hợp lệ đầu tiên.
function updateOperationStoreSubTabVisibility(user) {
  const tabs = [
    ['OPEN', 'btnOpStoreSubOpen', 'STORE_OPEN'],
    ['REPAIR', 'btnOpStoreSubRepair', 'REPAIR'],
    ['ESTIMATE', 'btnOpStoreSubEstimate', 'ESTIMATE'],
    ['EXECUTION', 'btnOpStoreSubExecution', 'EXECUTION'],
    ['ACCEPTANCE', 'btnOpStoreSubAcceptance', 'ACCEPTANCE'],
    ['REPORT', 'btnOpStoreSubReport', 'REPORT']
  ];
  let firstVisible = null;
  let activeStillVisible = false;
  tabs.forEach(([tabKey, btnId, permKind]) => {
    const visible = canAccessOperationSubTab(user, permKind);
    document.getElementById(btnId).classList.toggle('hidden', !visible);
    if (visible && !firstVisible) firstVisible = tabKey;
    if (visible && tabKey === activeOperationStoreSubTab) activeStillVisible = true;
  });
  if (firstVisible && !activeStillVisible) activeOperationStoreSubTab = firstVisible;
}

function setOfficeSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  resetListPage('office');
  if (subTab === 'PAYMENT') {
    if (!canAccessPaymentModule(currentUser)) {
      alert('⛔ Bạn không có quyền truy cập module Thanh toán!');
      return;
    }
  } else if (!canAccessOfficeSubTab(currentUser, subTab)) {
    alert('⛔ Bạn không có quyền truy cập phân hệ văn phòng này!');
    return;
  }
  activeOfficeSubTab = subTab;

  const btnBuy = document.getElementById('btnSubBuy');
  const btnFix = document.getElementById('btnSubFix');
  const btnPayment = document.getElementById('btnSubPayment');
  const activeCls = 'px-3 py-1 rounded text-xs font-bold bg-teal-700 text-white';
  const inactiveCls = 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700';

  if (btnBuy) {
    btnBuy.classList.toggle('hidden', !canAccessOfficeSubTab(currentUser, 'MUA_BAN'));
    btnBuy.className = subTab === 'MUA_BAN' ? activeCls : inactiveCls;
  }
  if (btnFix) {
    btnFix.classList.toggle('hidden', !canAccessOfficeSubTab(currentUser, 'SUA_CHUA'));
    btnFix.className = subTab === 'SUA_CHUA' ? activeCls : inactiveCls;
  }
  if (btnPayment) {
    const canPay = canAccessPaymentModule(currentUser);
    btnPayment.className = (subTab === 'PAYMENT' ? 'px-3 py-1 rounded text-xs font-bold bg-amber-700 text-white' : inactiveCls) + (canPay ? '' : ' hidden');
  }

  document.getElementById('officeReqsContentWrap').classList.toggle('hidden', subTab === 'PAYMENT');
  document.getElementById('paymentSection').classList.toggle('hidden', subTab !== 'PAYMENT');
  if (subTab === 'PAYMENT') {
    document.getElementById('officeSubTitle').innerText = 'Module con "Thanh toán": tổng hợp đề nghị thanh toán từ Hợp đồng/Mua Bán/Sửa Chữa và tạo thủ công.';
    setPaymentSubTab(activePaymentSubTab);
    return;
  }

  const lblSub = document.getElementById('officeSubTitle');
  if (lblSub) {
    if (subTab === 'MUA_BAN') lblSub.innerText = 'Phân hệ Đề Xuất Mua Sắm Trang Thiết Bị / Vật Tư Văn Phòng.';
    if (subTab === 'SUA_CHUA') lblSub.innerText = 'Phân hệ Đề Xuất Sửa Chữa / Bảo Trì Cơ Sở Vật Chất.';
  }

  // Phân hệ Mua Sắm dùng bảng nhiều hạng mục theo Mẫu BM-TS01 (Phiếu Đề Nghị Mua Sắm Tài Sản) thay
  // vì 1 dòng Số Lượng/Dự Toán/Nhà Cung Cấp như Sửa Chữa & Đầu Tư — không có mẫu giấy nên giữ nguyên.
  const isMuaSam = subTab === 'MUA_BAN';
  document.getElementById('officeItemsSection').classList.toggle('hidden', !isMuaSam);
  document.getElementById('officeUsageTimeField').classList.toggle('hidden', !isMuaSam);
  document.getElementById('officeQtyField').classList.toggle('hidden', isMuaSam);
  document.getElementById('officeAmountField').classList.toggle('hidden', isMuaSam);
  document.getElementById('officeSupplierField').classList.toggle('hidden', isMuaSam);
  document.getElementById('offQty').required = !isMuaSam;
  document.getElementById('offAmount').required = !isMuaSam;
  if (isMuaSam && officeItems.length === 0) addOfficeItemRow();

  renderDynamicInputsForModule(subTab, 'dynamicFieldsContainer_OFFICE');
  renderOfficeReqs();
  document.getElementById('offCode').value = generateOfficeCode(); // viết tắt mã đổi theo subTab (MB/SC/DT)
}

// Đổ danh sách "Chuyên đề" cho 2 <select> riêng của #internalPostForm (internalPostCategory cho NEWS,
// internalPostCategoryShare cho SHARE — xem CORE_FIELD_MANIFEST.INTERNAL_POST) — value là KEY (khớp
// payload.postCategory server yêu cầu, xem lib/createValidation.js), giữ lại lựa chọn hiện tại nếu còn
// hợp lệ (cùng khuôn subTypeSel ở populateDropdowns()). Gọi lại mỗi khi DB.internalNewsCategories/
// internalShareCategories đổi (populateDropdowns() sau initDatabase()/sau khi admin lưu danh sách ở màn
// Biểu Mẫu) — KHÔNG phụ thuộc activeInternalSubTab, setInternalSubTab() chỉ lo ẩn/hiện wrapper.
// Chức Danh (uJobTitle) phụ thuộc Vị Trí (uPosType, mục 4a) — HO dùng DB.jobTitles (Khối Văn Phòng),
// Siêu Thị dùng DB.storeJobTitles (mảng {label, restrictedFromSelfService}). KHÔNG lọc
// restrictedFromSelfService ở đây — hạn chế đó chỉ áp dụng cho form RÚT GỌN "Quản Lý Nhân Viên Siêu
// Thị" (mục 4b); form Người Dùng đầy đủ này do Admin/uniformManage thao tác nên vẫn chọn được mọi chức
// danh siêu thị, kể cả chức danh đã bị khoá tự tạo. Tách khỏi populateDropdowns() (logic tĩnh cũ) để
// gọi lại được riêng mỗi khi đổi Vị Trí, không cần render lại toàn bộ dropdown khác của trang. CHUYỂN từ
// module-admin-submissiongroups.js sang đây (Hạ tầng: nạp module theo cụm, đợt 7) — populateDropdowns()
// gọi thẳng hàm này ở MỌI switchTab(), không riêng gì tab Hệ Thống/Admin.
function populateUserJobTitleOptions(posType) {
  const uJobTitle = document.getElementById('uJobTitle');
  if (!uJobTitle) return;
  const current = uJobTitle.value;
  const options = posType === 'STORE' ? (DB.storeJobTitles || []).map(t => t.label) : (DB.jobTitles || []);
  uJobTitle.innerHTML = '<option value="">-- Chưa gán --</option>' + options.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  if (options.includes(current)) uJobTitle.value = current;
}

function populateInternalPostCategorySelects() {
  const fillCategorySelect = (selId, list) => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">-- Chọn chuyên đề --</option>' +
      (list || []).map(c => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`).join('');
    if ((list || []).some(c => c.key === current)) sel.value = current;
  };
  fillCategorySelect('internalPostCategory', DB.internalNewsCategories);
  fillCategorySelect('internalPostCategoryShare', DB.internalShareCategories);
}

// Đổ danh sách "Danh Mục" cho ô #itTicketCategory (Hỗ Trợ Yêu Cầu IT, xem CORE_FIELD_MANIFEST.IT_TICKET) —
// value là KEY (khớp payload.category server yêu cầu, xem lib/createValidation.js itSupportTickets),
// cùng khuôn populateInternalPostCategorySelects() ở trên. Gọi lại mỗi khi DB.itTicketCategories đổi
// (populateDropdowns() sau initDatabase()/sau khi admin lưu danh sách ở màn Biểu Mẫu).
function populateItTicketCategorySelect() {
  const sel = document.getElementById('itTicketCategory');
  if (!sel) return;
  const current = sel.value;
  const list = DB.itTicketCategories || [];
  sel.innerHTML = list.map(c => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`).join('');
  if (list.some(c => c.key === current)) sel.value = current;
}

// Nhãn hiển thị hiện tại (đổi theo admin) của 1 category IT Ticket — fallback về nhãn gốc (defaults.js)
// nếu key không còn trong DB.itTicketCategories (VD dữ liệu cũ trước khi seed chạy).
function getItTicketCategoryLabel(key) {
  const found = (DB.itTicketCategories || []).find(c => c.key === key);
  if (found) return found.label;
  return IT_TICKET_CATEGORY_LABELS_DEFAULT[key] || key;
}

function populateDropdowns() {
  const selDept = document.getElementById('selDept');
  if (selDept) {
    // CẬP NHẬT: trước đây dùng getUserAllowedDepts() — hàm đó gộp cả viewDraftDepts/viewApprovedDepts
    // (chỉ để XEM) vào danh sách, và mặc định trả về TOÀN BỘ phòng ban nếu rỗng — khiến dropdown tải
    // lên tài liệu gần như không lọc gì. Nay dùng đúng phạm vi TẠO (uploadAll/uploadDepts), cùng cơ chế
    // getScopedDepts()/scopeAllows() như 5 module Trình/Hợp đồng/Họp/Xe/Văn phòng — khớp với server
    // (xem lib/createValidation.js CREATE_MODULE_CONFIGS.docs.getScope).
    const docCreateScope = { all: !!currentUser.perms?.uploadAll, depts: currentUser.perms?.uploadDepts || [] };
    selDept.innerHTML = '<option value="">-- Chọn Phòng Ban Trình --</option>' +
      getScopedDepts(currentUser, docCreateScope).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }

  const filterDept = document.getElementById('filterDept');
  if (filterDept) {
    filterDept.innerHTML = '<option value="">-- Tất cả phòng ban --</option>' +
      DB.depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }

  // Dropdown "Lọc Theo Phòng Ban" của các module khác — cùng danh sách toàn bộ phòng ban (không
  // giới hạn theo quyền tạo mới, vì kết quả hiển thị đã được lọc theo quyền xem ở nơi khác).
  ['filterDeptSub', 'filterDeptContract', 'filterDeptCar', 'filterDeptOffice', 'filterDeptMeeting', 'reportsDeptFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">-- Tất cả phòng ban --</option>' + DB.depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  });

  const selCat = document.getElementById('selCat');
  if (selCat) {
    selCat.innerHTML = '<option value="">-- Chọn Phân Loại --</option>' + 
      DB.cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }

  // CẬP NHẬT: mỗi module giờ chỉ cho chọn phòng ban trong phạm vi quyền "Tạo mới" của người dùng
  // (trước đây các dropdown này liệt kê TẤT CẢ phòng ban, ai cũng tạo được hồ sơ "thay mặt" phòng
  // ban khác) — dùng getScopedDepts() dựa trên perms.<module>Create tương ứng.
  const subDept = document.getElementById('subDept');
  if (subDept) {
    subDept.innerHTML = getScopedDepts(currentUser, currentUser.perms?.submissionCreate).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }

  const contractDept = document.getElementById('contractDept');
  if (contractDept) {
    contractDept.innerHTML = getScopedDepts(currentUser, currentUser.perms?.contractCreate).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }

  // Đơn Vị Tiếp Nhận Theo Dõi & Thanh Toán (custodianDept) — KHÔNG lọc theo scope contractCreate như
  // contractDept ở trên: người tạo có thể giao cho BẤT KỲ đơn vị nào trong toàn công ty theo dõi & thanh
  // toán (khớp đúng idiom paymentDept bên dưới — cùng lý do: đây là "giao việc cho đơn vị khác", không
  // phải "tạo hồ sơ thay mặt đơn vị khác"). Option rỗng đầu = "để trống -> mặc định đơn vị quản lý".
  const contractCustodianDept = document.getElementById('contractCustodianDept');
  if (contractCustodianDept) {
    contractCustodianDept.innerHTML = '<option value="">-- Mặc định (đơn vị quản lý ở trên) --</option>' +
      DB.depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }

  const meetingDept = document.getElementById('meetingDept');
  if (meetingDept) {
    meetingDept.innerHTML = getScopedDepts(currentUser, currentUser.perms?.meetingBookScope).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }

  // Đơn Vị/Siêu Thị Đăng Tuyển (recruitmentJobs.dept, Đợt 2 Bản Tin Tuyển Dụng) — cùng khuôn paymentDept/
  // contractCustodianDept ở trên: "đăng tin CHO đơn vị nào" chứ không phải "tạo hồ sơ thay mặt đơn vị
  // khác", nên liệt kê TOÀN BỘ DB.depts + DB.stores gộp chung 1 dropdown, không lọc theo scope tạo.
  const rjDept = document.getElementById('rjDept');
  if (rjDept) {
    const currentRjDept = rjDept.value;
    rjDept.innerHTML = '<option value="">-- Chọn đơn vị/siêu thị --</option>' +
      [...DB.depts, ...DB.stores].map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    if ([...DB.depts, ...DB.stores].includes(currentRjDept)) rjDept.value = currentRjDept;
  }
  const rjFilterDept = document.getElementById('rjFilterDept');
  if (rjFilterDept) {
    const currentFilterDept = rjFilterDept.value;
    rjFilterDept.innerHTML = '<option value="">-- Tất cả đơn vị/siêu thị --</option>' +
      [...DB.depts, ...DB.stores].map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    if ([...DB.depts, ...DB.stores].includes(currentFilterDept)) rjFilterDept.value = currentFilterDept;
  }

  const meetingRoomSel = document.getElementById('meetingRoom');
  if (meetingRoomSel) {
    const current = meetingRoomSel.value;
    meetingRoomSel.innerHTML = MEETING_ROOMS.map(r => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
    if (MEETING_ROOMS.some(r => r.name === current)) meetingRoomSel.value = current;
  }

  const carDept = document.getElementById('carDept');
  if (carDept) {
    carDept.innerHTML = getScopedDepts(currentUser, currentUser.perms?.carCreate).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }

  const offDept = document.getElementById('offDept');
  if (offDept) {
    offDept.innerHTML = getScopedDepts(currentUser, currentUser.perms?.officeCreate).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }
  // paymentManage là quyền toàn công ty (không theo phòng ban) — dropdown Phòng Ban ở form tạo đề
  // nghị thanh toán thủ công liệt kê TOÀN BỘ DB.depts, không lọc theo scope như các module khác.
  const paymentDept = document.getElementById('paymentDept');
  if (paymentDept) {
    paymentDept.innerHTML = DB.depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }

  const uDept = document.getElementById('uDept');
  if (uDept) {
    uDept.innerHTML = DB.depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }
  const uStore = document.getElementById('uStore');
  if (uStore) {
    uStore.innerHTML = DB.stores.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  }

  // uJobTitle phụ thuộc uPosType (mục 4a) — xem populateUserJobTitleOptions()/onUserPosTypeChange().
  populateUserJobTitleOptions(document.getElementById('uPosType')?.value || 'HO');

  // Loại Tờ Trình / Loại Pháp Lý (Hợp đồng) / Loại Xe — TRƯỚC ĐÂY <option> gõ cứng, giờ đổ động từ
  // DB.submissionTypes/contractTypes/carTypes (admin tự thêm/bớt ở màn Biểu Mẫu, xem CORE_FIELD_MANIFEST).
  const subTypeSel = document.getElementById('subType');
  if (subTypeSel) {
    const current = subTypeSel.value;
    subTypeSel.innerHTML = DB.submissionTypes.map(t => `<option value="${escapeHtml(t.label)}">${escapeHtml(t.label)}</option>`).join('');
    if (DB.submissionTypes.some(t => t.label === current)) subTypeSel.value = current;
  }

  // Chuyên đề Nhịp Sống HCRC (NEWS) / Góc Chia Sẻ (SHARE) — cùng khuôn subType ở trên nhưng value là
  // KEY (không phải label) vì extraValidate ở lib/createValidation.js tra theo key
  // (catList.some(c => c.key === catKey)), khác submissionTypes lịch sử vẫn lưu payload.type = label.
  populateInternalPostCategorySelects();

  // "Cấp Phê Duyệt Cuối Cùng" — KHAC ("Phê duyệt khác") đặt ĐẦU danh sách nên là option mặc định
  // (kể cả sau khi form.reset() trả select về option đầu tiên, không có thuộc tính selected riêng).
  const subApprovalLevelSel = document.getElementById('subApprovalLevel');
  if (subApprovalLevelSel && !subApprovalLevelSel.options.length) {
    const ordered = [SUBMISSION_APPROVAL_LEVELS.find(l => l.key === 'KHAC'), ...SUBMISSION_APPROVAL_LEVELS.filter(l => l.key !== 'KHAC')];
    subApprovalLevelSel.innerHTML = ordered.map(l => `<option value="${escapeHtml(l.key)}">${escapeHtml(l.label)}</option>`).join('');
  }

  const contractTypeSel = document.getElementById('contractType');
  if (contractTypeSel) {
    const current = contractTypeSel.value;
    contractTypeSel.innerHTML = DB.contractTypes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if (DB.contractTypes.includes(current)) contractTypeSel.value = current;
  }

  // Cùng khuôn subApprovalLevelSel ở trên — KHAC ("Phê duyệt khác") đặt đầu danh sách làm mặc định.
  const contractApprovalLevelSel = document.getElementById('contractApprovalLevel');
  if (contractApprovalLevelSel && !contractApprovalLevelSel.options.length) {
    const orderedC = [CONTRACT_APPROVAL_LEVELS.find(l => l.key === 'KHAC'), ...CONTRACT_APPROVAL_LEVELS.filter(l => l.key !== 'KHAC')];
    contractApprovalLevelSel.innerHTML = orderedC.map(l => `<option value="${escapeHtml(l.key)}">${escapeHtml(l.label)}</option>`).join('');
  }

  const carTypeSel = document.getElementById('carType');
  if (carTypeSel) {
    const current = carTypeSel.value;
    carTypeSel.innerHTML = DB.carTypes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if (DB.carTypes.includes(current)) carTypeSel.value = current;
  }

  // Danh Mục Yêu Cầu Hỗ Trợ IT — cùng khuôn subType/contractType/carType ở trên.
  populateItTicketCategorySelect();
}

function updateUploadDeptDropdown() {
  const allowedDepts = getUserAllowedDepts(currentUser);
  const uploadBox = document.getElementById('uploadBox');
  
  const canUpload = currentUser.perms.admin || currentUser.perms.uploadAll || (currentUser.perms.uploadDepts && currentUser.perms.uploadDepts.length > 0);
  if (uploadBox) {
    uploadBox.classList.toggle('hidden', !canUpload);
  }
}

// ==========================================
// "PHIẾU PHÊ DUYỆT" DỰNG ĐỘNG — khung dùng chung cho mọi module có luồng duyệt nhiều bước
// (Đăng ký Xe, Văn bản trình...). Mỗi module chỉ cần cung cấp phần bảng trường thông tin riêng
// (bodyHTML) + dữ liệu người trình; khung (watermark, tiêu đề, khối chữ ký, ghi chú cuối) và CSS
// dùng chung để tránh lặp lại. CSS nhúng trực tiếp trong nội dung (không phụ thuộc Tailwind của
// trang chính) vì file tải về / cửa sổ in không load Tailwind.
// ==========================================

// Tra chức danh (DB.jobTitles) của 1 người theo username, dùng để hiện kèm tên trên chân ký phê
// duyệt — trả '' nếu không tìm thấy user hoặc user chưa được gán chức danh (không hiện gì thêm,
// không phải lỗi, đa số user hiện tại chưa có chức danh cho tới khi admin gán dần).
function getUserJobTitle(username) {
  const u = DB.users.find(x => x.username === username);
  return u?.jobTitle || '';
}

// Dựng 1 cột chữ ký cho 1 bước quy trình, dựa trên lịch sử xử lý (history) của hồ sơ — không
// hard-code cứng tên vai trò để khớp bất kỳ quy trình nào admin tự cấu hình ở module Quy Trình.
// CẬP NHẬT: 1 bước có thể có NHIỀU người đồng duyệt cùng ký — hiển thị đủ tất cả (trước đây chỉ
// lấy người duyệt đầu tiên tìm thấy, bỏ sót các đồng phê duyệt còn lại). CẬP NHẬT: hiện thêm chức
// danh (nếu người duyệt đã được admin gán) ngay dưới tên — tra theo h.username đã có sẵn trong mỗi
// entry lịch sử (lib/workflowEngine.js luôn ghi kèm cả 2: approver=tên hiển thị, username=định danh).
function buildApprovalSignatureColumnHTML(step, history) {
  const entries = (history || []).filter(h => h.step === step.order && h.action === 'APPROVED');
  if (entries.length === 0) {
    return `
      <td>
        <span class="as-sign-role">${escapeHtml(step.name)}</span>
        <div class="as-sign-time" style="margin-top:44px;">Chưa duyệt</div>
      </td>
    `;
  }
  const namesHTML = entries.map(e => {
    const jobTitle = getUserJobTitle(e.username);
    return `
    <div class="as-sign-name">${escapeHtml(e.approver)}</div>
    ${jobTitle ? `<div class="as-sign-jobtitle">${escapeHtml(jobTitle)}</div>` : ''}
    <div class="as-sign-time">Lúc: ${escapeHtml(e.time)}</div>
  `;
  }).join('<div style="height:6px;"></div>');
  return `
    <td>
      <span class="as-sign-role">${escapeHtml(step.name)}</span>
      <div class="as-sign-stamp">✅ ĐÃ PHÊ DUYỆT</div>
      ${namesHTML}
    </td>
  `;
}

function buildApprovalSlipShellHTML(opts) {
  const {
    formCode = '', title, approvedNote, bodyHTML,
    requesterRoleLabel = 'Người đề nghị', requesterName, requesterUsername, requesterTime,
    signatureColumnsHTML, footerNote
  } = opts;
  const requesterJobTitle = requesterUsername ? getUserJobTitle(requesterUsername) : '';

  return `
    <div class="approval-slip">
      <style>
        .approval-slip { font-family: 'Times New Roman', Georgia, serif; color: #111; background: #fff; padding: 24px; max-width: 800px; margin: 0 auto; position: relative; font-size: 13px; line-height: 1.55; }
        .approval-slip .as-watermark { position: absolute; top: 42%; left: 50%; transform: translate(-50%,-50%) rotate(-28deg); font-size: 26px; font-weight: bold; color: rgba(200,0,0,0.13); white-space: nowrap; pointer-events: none; z-index: 0; text-transform: uppercase; text-align: center; }
        .approval-slip .as-content { position: relative; z-index: 1; }
        .approval-slip .as-header { text-align: center; margin-bottom: 6px; }
        .approval-slip .as-form-code { font-size: 11px; color: #555; }
        .approval-slip .as-title { font-size: 19px; font-weight: bold; text-transform: uppercase; margin: 6px 0; }
        .approval-slip .as-approved-note { font-size: 11px; font-style: italic; color: #16a34a; font-weight: bold; }
        .approval-slip table.as-field-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        .approval-slip table.as-field-table td { padding: 3px 4px; vertical-align: top; }
        .approval-slip .as-label { font-weight: bold; width: 230px; white-space: nowrap; }
        .approval-slip .as-section-title { font-weight: bold; margin-top: 14px; margin-bottom: 2px; background: #f0f0f0; padding: 4px 6px; }
        .approval-slip table.as-items-table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 12px; }
        .approval-slip table.as-items-table th, .approval-slip table.as-items-table td { border: 1px solid #999; padding: 4px 6px; }
        .approval-slip table.as-items-table th { background: #f0f0f0; font-weight: bold; text-align: center; }
        .approval-slip .as-items-center { text-align: center; }
        .approval-slip .as-items-right { text-align: right; }
        .approval-slip .as-sign-table { width: 100%; border-collapse: collapse; margin-top: 22px; table-layout: fixed; }
        .approval-slip .as-sign-table td { text-align: center; vertical-align: top; padding: 8px 6px; border: 1px solid #ccc; }
        .approval-slip .as-sign-role { font-weight: bold; text-transform: uppercase; display: block; margin-bottom: 6px; }
        .approval-slip .as-sign-stamp { border: 2px solid #16a34a; color: #16a34a; display: inline-block; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 10px; transform: rotate(-6deg); margin: 6px 0 4px; }
        .approval-slip .as-sign-name { font-weight: bold; margin-top: 2px; }
        .approval-slip .as-sign-jobtitle { font-size: 11px; color: #444; font-style: italic; }
        .approval-slip .as-sign-time { font-size: 10.5px; color: #555; }
        .approval-slip .as-comment-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; padding: 8px 10px; margin: 6px 0; }
        .approval-slip .as-comment-box p { margin: 0; font-style: italic; }
        .approval-slip .as-comment-meta { margin-top: 4px; font-size: 11px; color: #666; text-align: right; }
        .approval-slip .as-footer-note { margin-top: 16px; font-size: 11px; color: #444; border-top: 1px solid #ccc; padding-top: 6px; }
        @media print { .approval-slip { padding: 0; } }
      </style>
      <div class="as-watermark">PHÊ DUYỆT TRÊN HỆ THỐNG<br>HCRC WORKSPACE</div>
      <div class="as-content">
        <div class="as-header">
          ${formCode ? `<div class="as-form-code">${escapeHtml(formCode)}</div>` : ''}
          <div class="as-title">${escapeHtml(title)}</div>
          <div class="as-approved-note">${approvedNote}</div>
        </div>

        ${bodyHTML}

        <table class="as-sign-table">
          <tr>
            <td>
              <span class="as-sign-role">${escapeHtml(requesterRoleLabel)}</span>
              <div class="as-sign-name">${escapeHtml(requesterName || '')}</div>
              ${requesterJobTitle ? `<div class="as-sign-jobtitle">${escapeHtml(requesterJobTitle)}</div>` : ''}
              <div class="as-sign-time">${requesterTime || ''}</div>
            </td>
            ${signatureColumnsHTML}
          </tr>
        </table>

        <div class="as-footer-note">${footerNote}</div>
      </div>
    </div>
  `;
}

// Dựng HTML "Phiếu Phê Duyệt Đăng Ký Xe" — theo đúng bố cục Mẫu Oto01 (đăng ký + phần Phòng Hành
// Chính) do người dùng cung cấp, ghép vào khung dùng chung buildApprovalSlipShellHTML().
function buildCarApprovalSlipHTML(car) {
  const wfConfig = DB.carDeptWorkflows[car.dept] || { workflowId: 'WF_1STEP' };
  const wf = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [{ order: 1, name: 'Duyệt' }] };
  const signatureColumnsHTML = wf.steps.map(step => buildApprovalSignatureColumnHTML(step, car.history)).join('');

  const bodyHTML = `
    <table class="as-field-table">
      <tr><td class="as-label">Thời gian đăng ký:</td><td>${escapeHtml(car.createdAt || '')}</td></tr>
      <tr><td class="as-label">Người đăng ký:</td><td>${escapeHtml(car.creatorName || '')}${car.registrantPhone ? ` — SĐT: ${escapeHtml(car.registrantPhone)}` : ''}</td></tr>
      <tr><td class="as-label">Đơn vị (Phòng/Ban/Bộ phận):</td><td>${escapeHtml(car.dept || '')}</td></tr>
      <tr><td class="as-label">Đăng ký sử dụng loại xe:</td><td>${escapeHtml(car.type || '')}</td></tr>
      <tr><td class="as-label">Số người sử dụng:</td><td>${escapeHtml(car.passengers || '')}</td></tr>
      <tr><td class="as-label">Người sử dụng trực tiếp:</td><td>${escapeHtml(car.directUser || car.creatorName || '')}${car.directUserPhone ? ` — SĐT: ${escapeHtml(car.directUserPhone)}` : ''}</td></tr>
      <tr><td class="as-label">Mục đích sử dụng:</td><td>${escapeHtml(car.purpose || '')}</td></tr>
      <tr><td class="as-label">Nội dung chi tiết:</td><td>${escapeHtml(car.reason || '')}</td></tr>
      <tr><td class="as-label">Lộ trình di chuyển:</td><td>${escapeHtml(car.destination || '')}</td></tr>
      <tr><td class="as-label">Thời gian sử dụng (dự kiến):</td><td>${escapeHtml(car.startTime || '')} ➔ ${escapeHtml(car.endTime || '')}</td></tr>
      <tr><td class="as-label">Số km dự kiến (2 chiều):</td><td>${car.km || 0} km</td></tr>
    </table>

    <div class="as-section-title">Phần dành cho Phòng Hành Chính</div>
    <table class="as-field-table">
      <tr><td class="as-label">Lái xe được phân công:</td><td>${escapeHtml(car.assignedDriver || car.driver || 'Chưa phân công')}</td></tr>
      <tr><td class="as-label">Loại xe cụ thể:</td><td>${escapeHtml(car.assignedVehicleType || '')}</td></tr>
      <tr><td class="as-label">Biển kiểm soát (BKS):</td><td>${escapeHtml(car.assignedPlate || car.plate || '')}</td></tr>
    </table>
  `;

  return buildApprovalSlipShellHTML({
    formCode: 'Mẫu: Oto01',
    title: 'Phiếu Đăng Ký Sử Dụng Xe Ô Tô',
    approvedNote: `✅ Đã phê duyệt hoàn tất trên Hệ thống Văn phòng điện tử — Mã phiếu: ${escapeHtml(car.code)}`,
    bodyHTML,
    requesterName: car.creatorName,
    requesterUsername: car.creator,
    requesterTime: `Đăng ký lúc: ${escapeHtml(car.createdAt || '')}`,
    signatureColumnsHTML,
    footerNote: 'Phiếu được lập và phê duyệt điện tử trên Hệ thống Văn phòng điện tử (VPĐT) — không cần chữ ký tay/con dấu bản cứng. Thông tin phê duyệt có thể tra cứu lại trên hệ thống.'
  });
}

function viewCarApprovalSlip(carId) {
  const c = DB.carRegs.find(item => item.id === carId);
  if (!c) return;
  if (c.status !== 'APPROVED') return alert('Chỉ xem được Phiếu Phê Duyệt sau khi đăng ký đã được phê duyệt hoàn tất.');

  document.getElementById('viewModalTitle').innerText = `🚗 Phiếu Phê Duyệt Đăng Ký Xe (${c.code})`;
  document.getElementById('viewModalSub').innerText = `Đơn vị: ${c.dept} | Người đăng ký: ${c.creatorName}`;
  document.getElementById('viewModalFooterInfo').innerText = 'Trạng thái: Đã phê duyệt hoàn tất';

  document.getElementById('viewModalContent').innerHTML = buildCarApprovalSlipHTML(c);
  document.getElementById('viewDocModal').classList.remove('hidden');
}

function downloadCarApprovalSlip(carId) {
  const c = DB.carRegs.find(item => item.id === carId);
  if (!c) return;
  if (c.status !== 'APPROVED') return alert('Chỉ tải được Phiếu Phê Duyệt sau khi đăng ký đã được phê duyệt hoàn tất.');

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Phiếu Phê Duyệt Đăng Ký Xe - ${escapeHtml(c.code)}</title></head><body>${buildCarApprovalSlipHTML(c)}</body></html>`;
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `PhieuPheDuyet_${c.code}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

// ==========================================
// CSP — hạ tầng event-delegation DÙNG CHUNG cho các module chuyển đổi từ đợt Hợp Đồng trở đi (thay cho
// kiểu OP_CLICK_ACTIONS/bindOperationDelegation riêng từng module ở trên, vốn phải viết tay 1 bảng tra
// cứu cho mỗi module). Không dùng bảng tra cứu tay — gọi thẳng window[fnName], hợp lệ vì mọi hàm xử lý
// trong file này đều là hàm global (script chính không phải type="module").
//   data-op / data-op-change / data-op-input = tên hàm gọi khi click/change/input.
//   data-op-submit = tên hàm gọi khi submit form (luôn nhận nguyên Event, không có tham số vị trí khác).
//   data-argN = tham số vị trí N (đọc kiểu số nếu khớp /^-?\d+$/, còn lại giữ nguyên chuỗi).
//   data-arg-value="N" = thay tham số vị trí N bằng el.value (thay cho onchange="fn(this.value)").
//   data-arg-el="N" = thay tham số vị trí N bằng chính phần tử DOM (thay cho tham số trần "this").
//   data-arg-event="N" = thay tham số vị trí N bằng Event thật (cho các hàm gọi e.stopPropagation()...).
//   data-op-prevent-default="1" = gọi e.preventDefault() trước khi gọi hàm xử lý.
//   data-op-seq="fn1(a,b)|fn2(c)" = nhiều lệnh gọi tuần tự (mẫu dropdown điều hướng sidebar), tham số
//   trong data-op-seq luôn là chuỗi enum đơn giản (tên tab/sub-tab), không phải biểu thức JS.
// ==========================================
// Hàm dùng chung cho các điểm onclick="event.stopPropagation()" cũ (chặn nổi bọt sự kiện lên phần tử
// cha, VD link tải file nằm trong 1 dòng/thẻ đang có onclick riêng mở modal chi tiết) — kết hợp
// data-arg-event="0" ở trên để nhận đúng Event thật.
function stopEventPropagation(e) { e.stopPropagation(); }
function cspCoerceArg(raw) {
  // Bo dau nhay bao ngoai neu co (vd data-op-seq="fn('literal')" — thay vi quy uoc thong thuong khong
  // dau nhay "fn(literal)") — cac gia tri con lai (khong dau nhay) giu nguyen hanh vi cu, khong doi.
  const unquoted = /^'(.*)'$/.test(raw) ? raw.slice(1, -1) : raw;
  return /^-?\d+$/.test(unquoted) ? Number(unquoted) : unquoted;
}
function cspReadArgSlot(el, i, evt) {
  if (el.dataset.argValue !== undefined && Number(el.dataset.argValue) === i) return el.value;
  if (el.dataset.argEl !== undefined && Number(el.dataset.argEl) === i) return el;
  if (el.dataset.argEvent !== undefined && Number(el.dataset.argEvent) === i) return evt;
  const raw = el.dataset['arg' + i];
  return raw === undefined ? undefined : cspCoerceArg(raw);
}
function cspCollectArgs(el, evt) {
  let maxIdx = -1;
  ['argValue', 'argEl', 'argEvent'].forEach(k => {
    if (el.dataset[k] !== undefined) maxIdx = Math.max(maxIdx, Number(el.dataset[k]));
  });
  Object.keys(el.dataset).forEach(k => {
    const m = /^arg(\d+)$/.exec(k);
    if (m) maxIdx = Math.max(maxIdx, Number(m[1]));
  });
  const args = [];
  for (let i = 0; i <= maxIdx; i++) args.push(cspReadArgSlot(el, i, evt));
  return args;
}
// cspRunSeq()/cspDispatchOp() — Ha tang: nap module theo cum, dot 7. TRUOC DAY 2 ham nay goi thang
// window[fnName] dong bo, gia dinh ham CHAC CHAN da co san (dung khi moi file module-*.js deu nap EAGER
// tu dau). Gio 1 phan file module-*.js chi nap LUOI khi vao dung tab/cum lien quan lan dau — ham dich co
// the CHUA co san tai thoi diem bam nut (vd nhay tu Trang chu/Approval Hub sang 1 module chua tung mo).
//
// QUAN TRONG: khi ham dich DA san sang (truong hop bau troi 99% — cum da nap tu truoc), 2 ham nay PHAI
// goi no THAT SU DONG BO, khong qua bat ky await nao — kể ca `await Promise.resolve()` cũng lùi 1 tick
// vi mo (microtask) so voi truoc day (goi thang window[fnName]() ngay lap tuc). 1 vai noi trong code (vd
// onUserPermGroupsChange(), gan qua data-op-change de cap nhat lai form NGAY khi tick nhom phan quyen)
// dua vao dung tinh dong bo nay: code goi sau do (readUserFormState() trong cung 1 hop callback dong bo)
// doc lai DOM ngay lap tuc, TRUOC KHI event-loop kip chay bat ky microtask nao — nếu chèn 1 await vào
// giữa, ham cap nhat form se chay CHAM 1 nhip, và code doc sau đó thay DOM CHUA duoc cap nhat (bug thuc
// su phat hien qua bo test hoi quy — xem VERSION.md). Vi vay: kiem tra typeof window[fnName] TRUOC, chi
// rơi vao nhanh await ensureFnReady() (co doi 1 nhip) o CHINH XAC truong hop hiem — ham thuc su chua nap.
function cspRunSeq(seqStr) {
  const parts = seqStr.split('|');
  let i = 0;
  function runFromCurrentIndex() {
    while (i < parts.length) {
      const part = parts[i++];
      const m = /^([A-Za-z_$][\w$]*)\((.*)\)$/.exec(part);
      if (!m) continue;
      const fnName = m[1];
      const fn = window[fnName];
      if (typeof fn === 'function') {
        const argStr = m[2];
        const args = argStr.length ? argStr.split(',').map(cspCoerceArg) : [];
        const result = fn.apply(null, args);
        // fn tra ve Promise (vd switchTab(), gio la ham bat dong bo) — buoc SAU trong chuoi co the phu
        // thuoc cum vua duoc fn nap xong, PHAI cho xong roi moi tiep tuc (khong thi tiep tuc ngay dong bo).
        if (result && typeof result.then === 'function') {
          return result.then(runFromCurrentIndex, err => {
            console.error('CSP dispatch (seq):', fnName, err);
            alert('⛔ Không tải được phần chức năng cần thiết. Vui lòng tải lại trang và thử lại.');
          });
        }
        continue;
      }
      // Ham CHUA nap — nhanh hiem, chi xay ra o lan dau vao 1 cum module-*.js chua tung mo trong phien.
      return ensureFnReady(fnName).then(() => {
        const fn2 = window[fnName];
        if (typeof fn2 !== 'function') return;
        const argStr = m[2];
        const args = argStr.length ? argStr.split(',').map(cspCoerceArg) : [];
        return fn2.apply(null, args);
      }).then(runFromCurrentIndex, err => {
        console.error('CSP dispatch (seq): không tải được mô-đun cho hàm', fnName, err);
        alert('⛔ Không tải được phần chức năng cần thiết. Vui lòng tải lại trang và thử lại.');
      });
    }
  }
  return runFromCurrentIndex();
}
function cspDispatchOp(el, evt, attrName) {
  const fnName = el.getAttribute(attrName);
  if (!fnName) return;
  if (el.dataset.opPreventDefault === '1') evt.preventDefault();
  const args = cspCollectArgs(el, evt);
  const fn = window[fnName];
  if (typeof fn === 'function') { fn.apply(null, args); return; }
  // Nhanh hiem: ham chua nap (cum module-*.js chua tung mo trong phien) — nap xong roi goi lai.
  ensureFnReady(fnName).then(() => {
    const fn2 = window[fnName];
    if (typeof fn2 !== 'function') { console.error('CSP dispatch: không tìm thấy hàm', fnName); return; }
    fn2.apply(null, args);
  }).catch(err => {
    console.error('CSP dispatch: không tải được mô-đun cho hàm', fnName, err);
    alert('⛔ Không tải được phần chức năng cần thiết. Vui lòng tải lại trang và thử lại.');
  });
}
function bindCspDelegation(rootId) {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-op], [data-op-seq]');
    if (!el || !root.contains(el)) return;
    if (el.hasAttribute('data-op-seq')) {
      if (el.dataset.opPreventDefault === '1') e.preventDefault();
      cspRunSeq(el.getAttribute('data-op-seq'));
    } else {
      cspDispatchOp(el, e, 'data-op');
    }
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-op-change]');
    if (!el || !root.contains(el)) return;
    cspDispatchOp(el, e, 'data-op-change');
  });
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-op-input]');
    if (!el || !root.contains(el)) return;
    cspDispatchOp(el, e, 'data-op-input');
  });
  root.addEventListener('submit', (e) => {
    const el = e.target.closest('[data-op-submit]');
    if (!el || !root.contains(el)) return;
    if (el.dataset.opPreventDefault === '1') e.preventDefault();
    const fnName = el.getAttribute('data-op-submit');
    const fn = window[fnName];
    if (typeof fn === 'function') { fn(e); return; }
    // Nhanh hiem: ham chua nap (cum module-*.js chua tung mo trong phien) — nap xong roi goi lai.
    ensureFnReady(fnName).then(() => {
      const fn2 = window[fnName];
      if (typeof fn2 === 'function') fn2(e);
    }).catch(err => {
      console.error('CSP dispatch (submit): không tải được mô-đun cho hàm', fnName, err);
      alert('⛔ Không tải được phần chức năng cần thiết. Vui lòng tải lại trang và thử lại.');
    });
  });
}
bindCspDelegation('userHeader');
// Hợp Đồng — mọi phần tử động (danh sách hợp đồng #contractTableBody, đợt thanh toán
// #contractInstallmentsList, dropdown Phê Duyệt #contractApprovalDropdownPanel) đều render VÀO BÊN
// TRONG #contractSection, không có modal nào sống ngoài section như Vận Hành — nên chỉ cần đúng 1 gốc.
bindCspDelegation('contractSection');
// Thanh Toán — danh sách đề nghị (#paymentTableBody), form tạo/sửa (#paymentCreateForm) và các đợt
// thanh toán (#paymentCreateInstallmentsList) đều render vào bên trong #paymentSection (openEditPaymentRequest()
// chỉ chuyển sub-tab + đổ dữ liệu vào ĐÚNG form đã có trong section, không mở modal riêng) — 1 gốc là đủ.
bindCspDelegation('paymentSection');
// Xe — danh sách đăng ký (#carTableBody), form đăng ký + điểm lộ trình (#carRoutePointsWrap), tab
// Lái Xe (#carDriverListWrap) đều render trong #carSection — nhưng modal Xử Lý Đăng Ký Xe
// (#carProcessModal, nút Duyệt/Từ chối/Bổ sung trong #carModalActionBtns) sống NGOÀI section (giống
// Vận Hành) nên cần thêm 1 gốc riêng cho modal.
bindCspDelegation('carSection');
bindCspDelegation('carProcessModal');
// Phòng Họp — danh sách lịch (#meetingTableBody, nút Duyệt/Hủy qua runMeetingAction/approveMeeting) và
// lịch dạng lưới (#meetingCalDate + renderMeetingCalendar()) đều render trong #meetingSection, không có
// modal xử lý riêng bên ngoài (approveMeeting()/cancelMeeting() gọi thẳng API, không mở modal) — 1 gốc
// là đủ, khác Xe/Vận Hành.
bindCspDelegation('meetingSection');
// Văn Phòng Phẩm — danh sách đăng ký (#vppRegTableBody qua renderVppRegistrations()), kỳ đăng ký
// (renderVppPeriods(), dùng buildActionCell() dùng chung — không đụng) và báo cáo đều render trong
// #vppSection — nhưng modal Xử Lý Đăng Ký (#vppRegModal, nút Duyệt/Từ chối/Bổ sung trong
// #vppRegModalActionBtns) sống NGOÀI section (giống Xe/Vận Hành) nên cần thêm 1 gốc riêng cho modal.
bindCspDelegation('vppSection');
bindCspDelegation('vppRegModal');
// Đào Tạo (LMS) — 9 sub-tab (Dashboard/Lớp Học/Chương Trình/Kế Hoạch/Đăng Ký Của Tôi/Kho Tài Liệu/Lộ
// Trình/Đào Tạo Tân Binh/Ngân Hàng Câu Hỏi) render hết trong #internalTrainingLmsSection — nhưng 6 modal
// xử lý riêng (Kết Quả Lớp Học, Danh Sách Học Viên, Sửa Lớp Học, Làm Bài Test, Mã QR, Vào Lớp Học) đều
// sống NGOÀI section (giống Xe/Vận Hành) nên mỗi modal cần thêm 1 gốc riêng — 7 gốc tổng cộng.
bindCspDelegation('internalTrainingLmsSection');
bindCspDelegation('trainingResultsModal');
bindCspDelegation('trainingRosterModal');
bindCspDelegation('trainingEditClassModal');
bindCspDelegation('trainingTakeTestModal');
bindCspDelegation('trainingClassQrModal');
bindCspDelegation('trainingJoinClassModal');
// Ngân Sách — 3 sub-tab (Phê Duyệt/Thực Hiện/Tổng Hợp) + danh sách bản ngân sách đều render trong
// #budgetSection — nhưng modal "⚙️ Quản Lý Kỳ & Mẫu" (#budgetPeriodTemplateModal, CRUD kỳ ngân sách +
// mẫu cột) và modal Xử Lý/Xem Chi Tiết (#budgetProcessModal, nút Duyệt/Từ Chối/Yêu Cầu Bổ Sung) đều
// sống NGOÀI section (giống Xe/Vận Hành/Đào Tạo) nên mỗi modal cần thêm 1 gốc riêng — 3 gốc tổng cộng.
bindCspDelegation('budgetSection');
bindCspDelegation('budgetPeriodTemplateModal');
bindCspDelegation('budgetProcessModal');

// Nhân Sự — #hrFeedbackManageContainer (renderHrFeedbackManage()) render TRONG #hrSection, 1 gốc là đủ.
bindCspDelegation('hrSection');
// Cơ Cấu Tổ Chức — module con riêng của Nhân Sự (#orgChartSection, TÁCH khỏi #hrSection — trước đây là
// sub-tab "hrSubOrgChart" CÙNG 1 module 'hr', xem BUSINESS_MODULES parent:'hr') — modal "Đổi Quản Lý
// Trực Tiếp" (#orgChartManagerModal) sống NGOÀI section (giống các modal khác) nên cần thêm 1 gốc
// riêng — 2 gốc tổng cộng.
bindCspDelegation('orgChartSection');
bindCspDelegation('orgChartManagerModal');

// Báo Cáo (#reportsSection) — thanh bộ lọc tĩnh + #reportsNavL1Bar/#reportsNavL2Bar + #reportsContent
// (renderReports()/renderModuleReport()/renderReportsSummary()...) đều nằm CHUNG trong #reportsSection
// nên chỉ cần 1 gốc. Modal "Xem Trước" (#reportPreviewModal, showReportPreview()) sống NGOÀI section
// nên cần thêm 1 gốc riêng — 2 gốc tổng cộng.
bindCspDelegation('reportsSection');
bindCspDelegation('reportPreviewModal');

// Quản Trị / Hệ Thống — cụm 6 màn con của tab "Hệ Thống" (Quản Trị #adminSection, Biểu Mẫu #formSection,
// Quy Trình & Phê Duyệt #workflowSection, Quản Lý Tệp File #uploadTypeSection, Log #logSection, Thùng
// Rác #trashSection) đều đã được chuyển thành CON TRỰC TIẾP của #systemSection (xem chú thích ở đầu
// #systemSection trong HTML — sửa hồi trước để thanh tab con sticky hoạt động đúng), nên chỉ cần ĐÚNG 1
// gốc duy nhất là bọc được toàn bộ, không cần 6 gốc riêng như dự kiến ban đầu. Không có modal nào của
// cụm này sống ngoài section: modal dùng chung "Gán vai trò cột" (#colRoleModal, openColumnRoleMappingModal())
// tuy được gọi từ Mẫu Ngân Sách/Biểu Mẫu nhưng lại nằm VẬT LÝ trong #itSupportSection (module Hỗ Trợ IT —
// gốc riêng của module đó ở dưới cũng bọc luôn #colRoleModal); #genericConfirmModal dùng chung toàn hệ
// thống (nhiều module khác cũng gọi), không riêng cụm này, để lại cho 1 đợt dọn hạ tầng dùng chung riêng
// sau này.
bindCspDelegation('systemSection');

// Hỗ Trợ IT — 3 sub-tab (Phê Duyệt Giá/Hỗ Trợ Yêu Cầu/Gia Hạn Dịch Vụ CNTT) đều render trong
// #itSupportSection, và modal dùng chung "Gán vai trò cột" (#colRoleModal, dùng cho Mẫu Ngân Sách) tuy
// thuộc về module Ngân Sách nhưng nằm VẬT LÝ bên trong #itSupportSection nên cũng được bọc theo — 1 gốc
// là đủ cho cả section. Nhưng có tới 4 modal xử lý/chi tiết sống NGOÀI section (giống Xe/Vận Hành/Đào
// Tạo): #itTicketModal (chi tiết + xử lý Yêu Cầu Hỗ Trợ), #itPriceModal (chi tiết + xử lý Đề Xuất Duyệt
// Giá) — cả 2 nằm chung khu modal với Ngân Sách phía dưới HTML — và #itRenewalRenewModal/#itRenewalEditModal
// (Gia Hạn/Sửa dịch vụ CNTT ở sub-tab Gia Hạn Dịch Vụ) nên mỗi modal cần thêm 1 gốc riêng — 5 gốc tổng cộng.
bindCspDelegation('itSupportSection');
bindCspDelegation('itTicketModal');
bindCspDelegation('itPriceModal');
bindCspDelegation('itRenewalRenewModal');
bindCspDelegation('itRenewalEditModal');

// Đồng Phục — 5 sub-tab (Kỳ Cấp Phát/Xác Nhận-Cấp Phát/Kho Đồng Phục/Tổng Quan/Quản Lý Nhân Viên Siêu
// Thị) đều render trong #uniformSection nên chỉ cần 1 gốc. 3 nút thao tác "Thu Hồi/Báo Hỏng/Báo Mất"
// của bảng "Đồng Phục Nhân Viên Đang Giữ" (openUniformHoldingActionModal()) KHÔNG mở modal riêng của
// module — dùng chung showConfirmModal()/#genericConfirmModal (đã bọc sẵn ở cụm Quản Trị/Hệ Thống phía
// trên, dùng chung toàn hệ thống) nên không cần thêm gốc thứ 2.
bindCspDelegation('uniformSection');

// Giấy Phép — thanh bộ lọc/form Cấp Mới-Cập Nhật (#licenseForm) và bảng danh sách
// (buildLicenseRowHTML(), nút Duyệt/Chi Tiết/toggleLicenseFamily) đều render trong
// #licenseSection nên chỉ cần 1 gốc. Modal "Chi Tiết & Lịch Sử Phiên Bản" (#licenseDetailModal,
// viewLicenseDetails() đổ nội dung vào #licenseDetailBody, nút Xem/Tải từng phiên bản file) sống
// NGOÀI section (giống Xe/Vận Hành/Đào Tạo) nên cần thêm 1 gốc riêng — 2 gốc tổng cộng. Danh mục
// Loại Giấy Phép (saveLicenseType/deleteLicenseType/renderLicenseTypeList) đã được chuyển sang
// data-op ở cụm Quản Trị/Hệ Thống phía trên (nằm vật lý trong #systemSection), không thuộc phạm vi
// module này.
bindCspDelegation('licenseSection');
bindCspDelegation('licenseDetailModal');

// Tuyển Dụng — 3 sub-tab (Tin Tuyển Dụng/Ứng Viên Tôi Giới Thiệu/Quản Lý Ứng Viên) đều render trong
// #internalRecruitmentSection nên chỉ cần 1 gốc. Modal "Giới Thiệu Ứng Viên" (#recruitmentReferModal,
// openRecruitmentReferModal()/submitRecruitmentReferral()) sống NGOÀI section (giống Xe/Vận Hành/Đào
// Tạo/Đồng Phục/Giấy Phép) nên cần thêm 1 gốc riêng — 2 gốc tổng cộng.
bindCspDelegation('internalRecruitmentSection');
bindCspDelegation('recruitmentReferModal');

// Truyền Thông Nội Bộ — 5 sub-tab (Nhịp Sống HCRC/Đào Tạo/Tuyển Dụng/Góc Chia Sẻ/HCRC Đồng Hành,
// setInternalSubTab()) đều render trong #internalSection nên chỉ cần 1 gốc — bao gồm form đăng bài
// (#internalPostForm, submitInternalPost()), form gửi câu hỏi + hộp thư cá nhân "HCRC Đồng Hành"
// (#hrFeedbackForm/submitHrFeedbackQuestion(), #hrFeedbackInboxContainer/openHrFeedbackAnswer() —
// phần NHÂN VIÊN, khác renderHrFeedbackManage() phía Nhân Sự đã chuyển ở đợt 12), bộ lọc feed và
// toàn bộ nút thao tác bài đăng/bình luận (renderInternalPosts()/renderInternalNewsFeed()/
// renderInternalNewsCard()/viewInternalPostDetail() sinh HTML nhưng gắn cùng gốc #internalSection vì
// nội dung render thẳng vào các container con của section, không tách DOM riêng). Modal xem chi tiết
// bài viết kiểu "trang báo" (#internalArticleModal, closeInternalArticleModal()) sống NGOÀI section
// (giống Xe/Vận Hành/Đào Tạo/Đồng Phục/Giấy Phép/Tuyển Dụng) nên cần thêm 1 gốc riêng — 2 gốc tổng
// cộng. 3 hàm wrapper mới do runtime data-op* chưa hỗ trợ trực tiếp: toggleInternalPinDurationWrap(el)
// (checkbox "Ghim bài" dùng this.checked — không có data-arg-checked, đọc lại el.checked qua
// data-arg-el), focusInternalCommentInput(id) (nút "Bình luận" gọi thẳng
// document.getElementById(...).focus(), không phải 1 lời gọi hàm đơn), toggleInternalCommentsExpandedAndView(id)
// (nút "Xem tất cả/Thu gọn bình luận" gọi 2 hàm liên tiếp với arg ${p.id} là biểu thức, không phải
// literal, nên không đủ điều kiện data-op-seq). Dropdown chuyển trạng thái trong buildActionCell()
// (nếu module này có dùng) và #genericConfirmModal vẫn để nguyên onclick — nằm trong đợt dọn hạ tầng
// dùng chung riêng, không thuộc module này.
bindCspDelegation('internalSection');
bindCspDelegation('internalArticleModal');

// Biên Bản Họp — form lập biên bản (#minutesForm, submitMeetingMinutes()/updateMeetingMinutes()),
// bảng Thành phần tham dự (#minutesAttendeesTableBody, renderAttendeesTable()) và bảng Ý kiến chỉ đạo
// (#minutesDirectivesTableBody, renderMinutesDirectivesTable()) đều render vào bên trong #minutesSection,
// cùng bộ lọc và danh sách biên bản (renderMeetingMinutes()/viewMeetingMinutesDetails() — modal xem chi
// tiết dùng chung #viewDocModal của nhiều module khác nên không cần gốc riêng ở đây) — 1 gốc là đủ.
// Modal soạn email thông báo người tham dự (#minutesEmailComposeModal, closeMinutesEmailComposeModal()/
// confirmSendMinutesEmail()) và modal Quản Lý Mẫu Danh Sách Tham Dự (#attendeeTemplateManagerModal,
// renderTplEditRowsTable()/saveAttendeeTemplateFromEditor()) sống NGOÀI section (giống Xe/Vận Hành/Đào
// Tạo/...) nên cần thêm 2 gốc riêng — 3 gốc tổng cộng. 2 hàm wrapper mới do runtime data-op* chưa hỗ
// trợ trực tiếp: applyMeetingAttendeeTemplateFromSelect() (nút "Áp Dụng" gọi
// applyMeetingAttendeeTemplate() với arg là document.getElementById(...).value, một biểu thức đọc DOM
// chứ không phải this/this.value/literal), updateMinutesDirectiveFieldMultiSelect(idx, field, el) (select
// multiple "Người phối hợp" cần Array.from(this.selectedOptions).map(o => o.value), không phải
// this.value đơn giản — đọc lại từ el qua data-arg-el). Dropdown chuyển trạng thái trong
// buildActionCell() (danh sách biên bản dùng chung) và #genericConfirmModal vẫn để nguyên onclick —
// nằm trong đợt dọn hạ tầng dùng chung riêng, không thuộc module này.
bindCspDelegation('minutesSection');
bindCspDelegation('minutesEmailComposeModal');
bindCspDelegation('attendeeTemplateManagerModal');

// Công Việc — form/danh sách/bộ lọc chính (#taskSection) cộng 7 modal sống NGOÀI section (giống Xe/Vận
// Hành/Đào Tạo/Biên Bản Họp/...): #createTaskModal (tạo/gán/sửa việc thủ công, dùng chung cho cả 3 chế
// độ openCreateTaskModal()/openAssignTaskModal()/openEditTaskModal()), #taskExtensionRequestModal/
// #taskExtensionApproveModal (xin/duyệt gia hạn), #taskCancelModal/#taskCancelApproveModal (2 bước huỷ
// việc), #taskProgressModal (cập nhật tiến độ + chia nhỏ công việc — renderProgressSubtasksList()),
// #taskDetailModal (xem chi tiết, nội dung do openTaskDetailModal() dựng động, không có handler tĩnh
// nào khác ngoài 2 nút đóng). 8 gốc tổng cộng. Không cần wrapper mới — 1 điểm duy nhất
// (confirmCollaboratorParticipationOnBehalf trong renderTasks(), tham số tên người là chuỗi literal có
// escaping JS-string thủ công `.replace(/'/g, "\\'")`) được sửa tay thay vì chạy qua script chuyển đổi:
// khi chuyển sang data-arg1, việc escape dấu nháy đơn kiểu JS-string là thừa (data-attribute không cần
// escape kiểu đó) nên bỏ hẳn .replace(), chỉ giữ escapeHtml() để an toàn HTML. Dropdown "Khác ▾" dùng
// chung trong buildActionCell() (mở hầu hết modal ở trên qua runTaskAction()) và #genericConfirmModal
// vẫn để nguyên onclick — nằm trong đợt dọn hạ tầng dùng chung riêng, không thuộc module này.
// bosungEditModal — modal "Bổ Sung" dùng chung nhiều module (docs/carRegs/officeReqs/submissions/
// operationOrders/operationStoreOpenings/operationRepairs); Mục C thêm picker Người Phụ Trách dùng
// data-op-change bên trong nên cần bọc CSP dispatcher (trước đây modal này không có phần tử động nào
// cần data-op-change/data-op nên chưa từng cần bindCspDelegation()).
bindCspDelegation('bosungEditModal');
bindCspDelegation('taskSection');
bindCspDelegation('createTaskModal');
bindCspDelegation('taskExtensionRequestModal');
bindCspDelegation('taskExtensionApproveModal');
bindCspDelegation('taskCancelModal');
bindCspDelegation('taskCancelApproveModal');
bindCspDelegation('taskProgressModal');
bindCspDelegation('taskDetailModal');

// Văn Bản Trình — form/bộ lọc/danh sách chính (#submissionSection, gồm cả dropdown "Phê duyệt"
// #subApprovalDropdownPanel và các nút Thao Tác chính render trong #submissionTableBody — tất cả nằm
// TRỰC TIẾP trong section, không có modal nào sống ngoài) cộng 1 modal sống NGOÀI section giống Công
// Việc/Xe/...: #submissionProcessModal ("Bút Phê & Xử Lý Tờ Trình" — nội dung do openProcessSubmissionModal()
// dựng động, gồm cả khối Xin Ý Kiến renderSubModalOpinions()). 2 gốc tổng cộng. Không cần wrapper mới —
// mọi tham số đều là ID/enum literal. Các nhánh dựng trong showConfirmModal()/#genericConfirmModal
// (openTroLyThuKyBoSungChoice(), openTroLyThuKyProposeFileForm(), openResolveFileProposalModal()) và
// dropdown "Khác ▾" dùng chung buildActionCell()/#viewDocModal vẫn để nguyên onclick — nằm trong đợt
// dọn hạ tầng dùng chung riêng, không thuộc module này.
bindCspDelegation('submissionSection');
bindCspDelegation('submissionProcessModal');

// Tài Liệu — form tải lên/bộ lọc/danh sách chính (#docSection, gồm cả nút mở rộng phiên bản
// toggleDocFamily() và nút Thao Tác chính render trong #docTableBody — tất cả nằm TRỰC TIẾP trong
// section) cộng 1 modal sống NGOÀI section: #docDetailModal ("Chi Tiết Tài Liệu" — bảng lịch sử phiên
// bản do viewDocDetails() dựng động, gồm nút Xem/Tải từng phiên bản). 2 gốc tổng cộng. Không cần
// wrapper mới — mọi tham số đều là ID/enum literal. Dropdown "Khác ▾" dùng chung buildActionCell(),
// #genericConfirmModal và #viewDocModal (khác #docDetailModal) vẫn để nguyên onclick — nằm trong đợt
// dọn hạ tầng dùng chung riêng, không thuộc module này. "Approval Hub" (#approvalHubSection, dùng
// getMyPendingApprovals() gộp hồ sơ chờ duyệt từ 9 module trong đó có Tài Liệu) cũng là hạ tầng dùng
// chung liên module, để dành cho đợt riêng.
bindCspDelegation('docSection');
bindCspDelegation('docDetailModal');

// Báo Cáo Định Kỳ — 4 sub-tab (Nhập Báo Cáo/Kỳ Báo Cáo/Tổng Hợp/Đã Phát Hành) cộng mọi khối render động
// (bảng #prEntryTableBody, #prPeriodsTableBody, #prPublishedTableBody, khối chọn+sắp thứ tự Tổng Hợp
// #prAggEntriesList/#prAggOrderList/#prAggSlidesList, khối Ghép PDF #prAggPdfEntriesList/#prAggPdfGrid,
// khối Đối Chiếu Theo Công Việc #prTaskCompilationSlidesList) đều render TRỰC TIẾP trong
// #periodicReportSection — nhưng #prSlideshowModal (Trình Chiếu Báo Cáo Định Kỳ toàn màn hình, cả 2 chế
// độ SLIDES/PDF) sống NGOÀI section (giống Xe/Vận Hành) nên cần thêm 1 gốc riêng. 2 gốc tổng cộng. 3
// wrapper mới cho checkbox tick báo cáo (onPrAggEntryCheckboxChange()/onPrAggPdfEntryCheckboxChange(),
// đọc this.checked — không có slot data-arg cho .checked) và nút ✕ bỏ chọn (untogglePrAggEntry(), tránh
// truyền literal boolean "false" qua data-argN vì cspCoerceArg() chỉ coerce được số nguyên, chuỗi "false"
// lại truthy). Nút Thao Tác chính ở #prPeriodsTableBody chỉ có dấu "—" (không có onclick), dropdown
// "Khác ▾" dùng chung buildActionCell()/#genericConfirmModal — vẫn để nguyên, nằm trong đợt dọn hạ tầng
// dùng chung riêng như mọi module trước.
bindCspDelegation('periodicReportSection');
bindCspDelegation('prSlideshowModal');

// CSP hạ tầng dùng chung (đợt H+I) — thanh mobile ☰/lớp nền mờ sống NGOÀI mọi section (#mobileTopBar,
// #sidebarBackdrop, xem toggleMobileSidebar()/closeMobileSidebar()) cộng 2 modal xác thực/bổ sung dùng
// chung liên module: #approvalAuthModal (OTP/mật khẩu/PIN trước khi duyệt, xem withApprovalAuth()) và
// #bosungEditModal (sửa + gửi lại hồ sơ bị trả về NHÁP, dùng chung Tài Liệu/Đăng Ký Xe/Mua Bán-Sửa
// Chữa-Đầu Tư/Văn Bản Trình). 4 gốc độc lập, không cần wrapper mới — mọi tham số đều literal.
bindCspDelegation('mobileTopBar');
bindCspDelegation('sidebarBackdrop');
bindCspDelegation('approvalAuthModal');
bindCspDelegation('bosungEditModal');

// CSP hạ tầng dùng chung (đợt G) — trang đăng nhập + 2 modal "tường chặn" bắt buộc trước khi vào hệ
// thống, độc lập hoàn toàn với mọi module nghiệp vụ: #loginSection (form đăng nhập, đổi tài khoản đã
// nhớ, bước TOTP, CAPTCHA, đăng nhập vân tay/Face ID), #mustChangePasswordModal (bắt đổi mật khẩu
// tạm/mặc định) và #totpSetupWallModal (bắt thiết lập 2FA cho admin chưa bật — checkbox xác nhận đã
// lưu mã khôi phục dùng wrapper setTotpBackupConfirmState() vì gốc là phép gán DOM trực tiếp, không
// phải 1 lời gọi hàm đơn). 3 gốc độc lập, không lồng nhau.
bindCspDelegation('loginSection');
bindCspDelegation('mustChangePasswordModal');
bindCspDelegation('totpSetupWallModal');

// CSP hạ tầng dùng chung (đợt C) — #viewDocModal: khung xem tệp/quy trình an toàn DÙNG CHUNG cho RẤT
// NHIỀU module (mở qua openFileProtectedView() dùng chung — viewDoc(), viewLicenseFile(),
// viewSubmissionAttachment(), viewSubmissionExtraFile(), viewFileProposalAttachment(),
// viewContractSignedFile(), viewOfficeSignedFile(), viewOperationAttachment(), viewPrCurrentSlideFile()
// — và các hàm tự dựng HTML rồi mở thẳng modal — previewSubmissionWorkflow(),
// previewContractApprovalWorkflow(), viewSubmissionApprovalSlip(), viewCarApprovalSlip(),
// viewOfficeApprovalSlip(), viewContractDetails(), viewMeetingMinutesDetails()). Chỉ 4 điểm onclick
// NẰM TRONG định nghĩa modal cần convert (closeViewDocModal() x2, printViewModalContent(),
// printWordWithWatermark()) — nút mở modal ở từng module là <a>/onclick riêng của module đó, không
// thuộc phạm vi đợt này (giữ nguyên hoặc đã convert ở đợt khác).
bindCspDelegation('viewDocModal');

// CSP hạ tầng dùng chung (đợt B) — #genericConfirmModal: modal xác nhận Đồng Ý/Hủy DÙNG CHUNG cho ~57
// lời gọi showConfirmModal() trải khắp gần hết hệ thống (Văn Bản Trình/Hợp Đồng/Văn Phòng/Ngân
// Sách/Giá IT/Giấy Phép/VPP/Đào Tạo/Đồng Phục/Biên Bản Họp/Nhân Sự...). 3 điểm onclick nằm trong định
// nghĩa tĩnh modal (nút ✕/Hủy gọi closeGenericConfirmModal(), nút #genericConfirmOkBtn gọi
// runConfirmedAction()) cộng 6 điểm onclick/onchange trong bodyHTML TỰ SOẠN của riêng luồng Trợ
// Lý/Thư Ký xử lý tờ trình (openTroLyThuKyBoSungChoice()/openTroLyThuKyProposeFileForm()/
// openResolveFileProposalModal()) đã convert sang data-op/data-op-seq. BUG ĐÃ XÁC MINH: gốc này CHƯA
// TỪNG được bindCspDelegation() ở bất kỳ đợt nào trước đây — rà soát toàn bộ ~53 lời gọi
// showConfirmModal() còn lại (bodyHTML dựng bằng backtick, kể cả template lồng nhau) xác nhận KHÔNG
// module nào khác từng đặt data-op/onclick/onchange bên trong bodyHTML của riêng mình (mọi module khác
// chỉ dùng bodyHTML thuần văn bản + nút Đồng Ý/Hủy mặc định của modal, hành động thật nằm trong callback
// onConfirm JS — không phải attribute HTML nên không cần data-op) — nghĩa là lỗ hổng bind này chưa từng
// làm im lặng bất kỳ luồng nào đã lên production, NHƯNG nếu không bind ngay trong đợt này thì 6 điểm
// data-op vừa convert ở luồng Trợ Lý/Thư Ký phía trên sẽ im lặng không chạy (đã demo Playwright xác
// nhận: bấm nút trong bodyHTML không phản ứng gì khi CHƯA bind, chạy đúng sau khi bind — xem báo cáo
// đợt B). 1 gốc duy nhất.
bindCspDelegation('genericConfirmModal');

// CSP hạ tầng dùng chung (đợt D) — #dashboardSection: nút "⚙️ Tuỳ chỉnh" (mở
// #dashboardCustomizeModal), thẻ dashboard động trong #dashboardStatsGrid (renderDashboard() ->
// handleDashboardCardClick(key)) và thẻ tin tức trong #dashboardNewsContainer (renderDashboardNews() ->
// 3 lời gọi nối tiếp switchTab()/setInternalSubTab()/viewInternalPostDetail(), mọi tham số literal nên
// dùng data-op-seq thay vì wrapper riêng). #dashboardCustomizeModal sống NGOÀI section (giống Xe/Vận
// Hành) nên cần gốc riêng — nút "Đóng" tĩnh + checkbox động trong #dashboardCustomizeList
// (openDashboardCustomizeModal() -> onDashboardCustomizeToggle(key, this.checked), cần
// onDashboardCustomizeToggleFromCheckbox() làm wrapper nhận phần tử qua data-arg-el rồi tự đọc .checked,
// vì tham số thứ 2 là boolean runtime không phải literal).
bindCspDelegation('dashboardSection');
bindCspDelegation('dashboardCustomizeModal');

// CSP hạ tầng dùng chung (đợt D) — #approvalHubSection: hộp thư duyệt tổng hợp gộp hồ sơ chờ duyệt từ
// GẦN NHƯ MỌI module nghiệp vụ (xem getMyPendingApprovals()/getMyProcessedApprovals()). 4 điểm tĩnh
// (bộ lọc Trạng Thái/Khoảng Thời Gian/Loại + ô tìm kiếm, đều gọi renderApprovalHub()) cộng 1 sink động
// quan trọng nhất đợt này: nút Duyệt/Từ chối/Xem trong #approvalHubTableBody trước đây là
// onclick="${a.onclick}" với a.onclick là 1 CHUỖI JS TỰ DO build sẵn ở ~29 nơi định nghĩa action rải
// khắp getMyPendingApprovals()/getMyProcessedApprovals() (Doc/Submission/Car/Office/Vpp/ItPrice/Budget/
// Contract x2 luồng/Meeting/InternalPost/FlaggedComment/License/Payment/ItPriceEmergencyReject/
// Operation x5) — đã tái cấu trúc field action.onclick sang action.fn (tên hàm) + action.args (mảng
// tham số, mọi phần tử đều id/enum literal đã có giá trị cụ thể lúc build, không có this.value/
// this.checked/biểu thức runtime) — sink giờ render generic data-op="${a.fn}" + data-argN theo đúng độ
// dài a.args, không còn onclick="${a.onclick}". 1 gốc duy nhất, không có modal riêng ngoài section.
bindCspDelegation('approvalHubSection');

// CSP hạ tầng dùng chung (đợt F) — #profileModal: "Hồ Sơ Cá Nhân" (nút mở modal ở #userHeader đã có
// data-op="openProfileModal" từ đợt trước, gốc bind riêng ở đây). 16 điểm tĩnh trong modal (nút đóng "✕"
// + 2 nút "Hủy", 5 nút chuyển sub-tab setProfileSubTab('INFO'|'PASSWORD'|'PIN'|'WEBAUTHN'|'TOTP'), 2
// form onsubmit đổi thông tin/đổi mật khẩu — cả 2 hàm savePersonalInfo()/changeMyPassword() đã tự gọi
// e.preventDefault() bên trong nên KHÔNG cần data-op-prevent-default, nút đổi PIN, nút đăng ký thiết bị
// vân tay, 3 nút khối TOTP: hiện lại QR cho máy thứ 2/chép khoá/gỡ TOTP, nút cài PWA) cộng 1 sink động
// trong #pfWebauthnListWrap (renderWebauthnDeviceList() -> deleteBiometricDevice(id), id đã biết lúc
// build HTML nên dùng data-arg0 thay vì literal, cùng khuôn với deleteAdminBiometricDevice() ở màn Sửa
// Người Dùng đã convert trước đó). Không có checkbox/this.checked trong modal này nên không cần wrapper
// riêng. 1 gốc duy nhất, không có modal con nào sống ngoài #profileModal.
bindCspDelegation('profileModal');

// CSP module Office (đợt E) — #officeSection/#officeProcessModal/#signedUploadModal: module "Tổng Hợp"
// (Mua Bán/Sửa Chữa/Đầu Tư, xem activeOfficeSubTab) CHƯA từng convert qua 23 đợt module trước, coi như
// module thứ 24. #officeSection: 3 nút chuyển sub-tab setOfficeSubTab('MUA_BAN'|'SUA_CHUA'|'PAYMENT'),
// form #officeForm (data-op-submit="submitOfficeReq" — submitOfficeReq(e) đã tự gọi e.preventDefault()
// nên KHÔNG cần data-op-prevent-default), nút "➕ Thêm Hạng Mục" addOfficeItemRow(), 5 điểm tĩnh lọc/tìm
// kiếm (4 onchange + 1 oninput, đều gọi onOfficeFilterChange()) cộng các sink động trong
// renderOfficeItemsTable() (bảng nhiều hạng mục Mẫu BM-TS01 — 5 ô input mỗi dòng gọi
// updateOfficeItemField(idx, field, this.value) dùng data-op-input + data-arg-value="2", 1 nút xoá dòng
// removeOfficeItemRow(idx)) và trong renderOfficeReqs() (nút chính "Xử lý/Duyệt" hoặc "Xem chi tiết" gọi
// runOfficeAction(o.id, 'process') — 2 nhánh cùng khuôn data-op, khối phụ "..." trong cùng ô Thao Tác vẫn
// dùng buildActionCell()/a.onclick cũ, để dành đợt A cùng pagination/buildDashboardCardsHTML).
// #officeProcessModal (modal duyệt/xử lý đề xuất): 2 nút đóng "✕"/"Đóng" cùng gọi
// closeOfficeProcessModal(), 3 nút hành động trong #officeModalActionBtns (renderer trong
// openOfficeProcessModal()) gọi confirmProcessOfficeReq('REJECT'|'REQUEST_CHANGES'|'APPROVE').
// #signedUploadModal (dùng CHUNG cho Hợp đồng lẫn Mua Bán/Sửa Chữa/Đầu Tư qua openSignedUploadModal(module,
// id), xem signedUploadTarget — trigger mở modal vẫn qua runOfficeAction ở trên nên gốc này chỉ có 2 điểm
// tĩnh: nút "Hủy" closeSignedUploadModal(), nút "Tải Lên" submitSignedUpload() — sau khi tải lên thành
// công với module officeReqs, alert nhắc bấm nút "💰 Chuyển Sang Thanh Toán" (startOfficePaymentAction(id),
// đã có data-op qua runOfficeAction case 'startPayment' — chỉ hiện khi canManageOfficePaymentClient() +
// đã có signedFileUrl + paymentStatus CHUA_THANH_TOAN). 3 gốc độc lập, không lồng nhau (dù #paymentSection
// — đã bindCspDelegation riêng ở đợt trước — nằm lồng vật lý trong #officeSection, không thuộc phạm vi
// đợt này).
bindCspDelegation('officeSection');
bindCspDelegation('officeProcessModal');
bindCspDelegation('signedUploadModal');

// ==========================================
// Ô TÌM-KIẾM-DÙNG-CHUNG (thay <input list="..."> + <datalist> NATIVE) — datalist gốc của trình duyệt
// hoá ra KHÔNG ĐÁNG TIN CẬY trên thực tế (người dùng xác nhận: gõ không ra gợi ý dù dữ liệu đúng, lặp
// lại y hệt trên cả Chrome/Firefox/Edge desktop lẫn Chrome Samsung/Safari iPhone — đã kiểm chứng lại
// bằng Playwright rằng dữ liệu/logic lọc phía server hoàn toàn đúng, lỗi nằm ở chính cơ chế <datalist>
// của trình duyệt). Mọi nơi trước đây dùng input[list=Y]/datalist[id=Y] giờ đổi sang
// input[data-sdd-list=Y]/div[id=Y][data-sdd-dropdown] tự dựng bằng JS thuần (không thư viện ngoài,
// không cần mạng) — định vị bằng position:fixed theo đúng toạ độ ô input đang gõ
// (getBoundingClientRect), không phụ thuộc CSS overflow/position của khối cha (kể cả trong
// <details>/modal) — tránh đúng lỗi z-index/mở-đóng lệch trạng thái mà bảng nút+panel tự dựng TRƯỚC
// ĐÓ từng gặp (xem ghi chú ở contractAddendumTargetWrap, lý do đổi sang datalist native lần đầu).
//
// CÁCH DÙNG — KHÔNG cần sửa gì các hàm resolveXxxInput()/oninput/onchange đang có sẵn ở từng nơi:
//   1. Đổi <input list="Y" oninput="...">  ->  <input data-sdd-list="Y" oninput="...">  (giữ NGUYÊN
//      oninput/onchange đang có).
//   2. Đổi <datalist id="Y">...</datalist>  ->  <div id="Y" class="hidden" data-sdd-dropdown></div>
//      (rỗng, không cần <option> tĩnh nữa).
//   3. Ở hàm JS trước đây ghi `datalist.innerHTML = list.map(x => '<option value="...">').join('')`,
//      đổi thành sddSetOptions('Y', list) — list là mảng string HOẶC mảng {value,label}.
// Khi người dùng bấm chọn 1 gợi ý: tự ghi input.value = label, tự bắn lại đúng 2 sự kiện 'input' VÀ
// 'change' lên input đó (bubbles:true) để mọi resolveXxxInput()/renderYyy() hiện có tự chạy lại y hệt
// như khi gõ tay xong rời khỏi ô — KHÔNG cần callback riêng cho từng nơi gọi. 1 div[id=Y] có thể
// dùng chung cho NHIỀU input khác nhau (khớp cách 1 datalist cũ phục vụ nhiều input, vd
// systemUsersDatalist) — tự định vị lại theo ĐÚNG ô đang có focus mỗi lần hiện.
// ==========================================
// stripVnDiacritics() - CHUYEN tu module-tailieu.js sang day (Ha tang: nap module theo cum, dot 7) -
// sddRenderRows() ngay duoi day goi thang ham nay khi go vao BAT KY o tim-kiem-go-chon (widget "sdd*")
// nao trong toan he thong, dung chung cho hau het module (xem CLAUDE.md) - khong the de nam o 1 file
// module-*.js duoc nap luoi. Bo dau tieng Viet de suy ra viet tat - dd/DD khong tach duoc qua NFD nen
// xu ly rieng.
function stripVnDiacritics(str) {
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function sddSetOptions(dropdownId, items) {
  const dd = document.getElementById(dropdownId);
  if (!dd) return;
  dd._sddItems = (items || [])
    .filter(it => it !== null && it !== undefined && it !== '')
    .map(it => (typeof it === 'string') ? { value: it, label: it } : it)
    .filter(it => it && typeof it.label === 'string');
}

function sddRenderRows(dd, query) {
  // Bỏ dấu tiếng Việt trước khi so khớp (query lẫn label) — gõ không dấu ("nguyen") vẫn ra đúng kết
  // quả có dấu ("Nguyễn"), dùng chung stripVnDiacritics() đã có sẵn (xem block đầu file).
  const q = stripVnDiacritics(String(query || '').trim().toLowerCase());
  const items = dd._sddItems || [];
  const matches = q ? items.filter(it => stripVnDiacritics(it.label.toLowerCase()).includes(q)) : items;
  const shown = matches.slice(0, 50);
  dd._sddShown = shown;
  dd.innerHTML = shown.length
    ? shown.map((it, i) => `<div class="px-2 py-1 hover:bg-sky-50 cursor-pointer truncate" data-sdd-idx="${i}">${escapeHtml(it.label)}</div>`).join('')
    : '<div class="px-2 py-1 text-gray-400 italic">Không tìm thấy.</div>';
}

function sddPositionAndShow(dd, input) {
  const rect = input.getBoundingClientRect();
  dd.style.left = Math.max(rect.left, 4) + 'px';
  dd.style.top = (rect.bottom + 2) + 'px';
  dd.style.width = Math.max(rect.width, 160) + 'px';
  dd._sddActiveInput = input;
  dd.classList.remove('hidden');
}

function sddHandleTrigger(ev) {
  const input = ev.target;
  const listId = input.getAttribute && input.getAttribute('data-sdd-list');
  if (!listId) return;
  const dd = document.getElementById(listId);
  if (!dd || !dd._sddItems) return;
  sddRenderRows(dd, input.value);
  sddPositionAndShow(dd, input);
}
document.addEventListener('input', sddHandleTrigger);
document.addEventListener('focusin', sddHandleTrigger);

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  const listId = ev.target.getAttribute && ev.target.getAttribute('data-sdd-list');
  if (listId) document.getElementById(listId)?.classList.add('hidden');
});

// Bấm chọn 1 gợi ý HOẶC bấm ra ngoài để đóng — gắn 1 LẦN DUY NHẤT (query lại theo [data-sdd-idx]/
// [data-sdd-dropdown] mỗi lần click, cùng triết lý với listener đóng renderPeopleMultiSelect() bên
// dưới — không gắn lại mỗi lần render, tránh chồng listener).
document.addEventListener('click', (ev) => {
  const row = ev.target.closest('[data-sdd-idx]');
  if (row) {
    const dd = row.closest('[data-sdd-dropdown]');
    const idx = Number(row.getAttribute('data-sdd-idx'));
    const item = dd && dd._sddShown && dd._sddShown[idx];
    const input = dd && dd._sddActiveInput;
    if (item && input) {
      input.value = item.label;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
    }
    dd?.classList.add('hidden');
    return;
  }
  document.querySelectorAll('[data-sdd-dropdown]:not(.hidden)').forEach(dd => {
    if (dd._sddActiveInput !== ev.target) dd.classList.add('hidden');
  });
});

// ==========================================
// DROPDOWN CHỌN NHIỀU NGƯỜI (tìm kiếm + chip) — dùng chung cho "Quản Lý Nhóm Phê Duyệt Trình" (chọn
// thành viên cố định của từng nhóm, có thể chọn từ TOÀN BỘ user) và form tạo Văn bản trình (chọn NGƯỜI
// CỤ THỂ tham gia duyệt 1 lớp bổ sung cho ĐÚNG tờ trình này, chỉ trong số thành viên nhóm). Thay vì
// liệt kê checkbox cho toàn bộ danh sách (cồng kềnh khi hệ thống nhiều người dùng), gõ tìm rồi bấm chọn
// — người đã chọn hiện dạng chip có nút xoá.
//
// Để KHÔNG phải sửa lại các hàm ĐỌC lựa chọn đã có sẵn (saveSubmissionApprovalGroup(),
// submitSubmissionReq()), mỗi người đã chọn vẫn được backing bằng 1 checkbox ẨN mang ĐÚNG
// class/data-attribute mà code đọc cũ đang query bằng document.querySelectorAll — chỉ đổi PHẦN HIỂN
// THỊ, giữ nguyên "hợp đồng" dữ liệu giữa các hàm.
function renderPeopleMultiSelect(containerId, candidates, initialSelected, checkboxClass, checkboxDataAttrs) {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Lọc bỏ phần tử null/undefined/thiếu username — cùng lớp lỗi vừa sửa ở sddSetOptions(): nếu DB.users
  // (hoặc mảng candidates bất kỳ truyền vào từ nơi gọi) lỡ có 1 phần tử rác, label()/renderChips()/
  // renderDropdown() bên dưới sẽ throw TypeError âm thầm ngay trong sự kiện oninput/onfocus, khiến
  // TOÀN BỘ ô chọn nhiều người này ngừng hoạt động không 1 dòng lỗi hiện ra.
  candidates = (candidates || []).filter(u => u && u.username);
  const dataAttrsStr = Object.entries(checkboxDataAttrs || {}).map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ');
  const selected = new Set(initialSelected || []);
  const label = (u) => `${u.name} (${u.username}) - ${u.dept}`;

  function renderChips() {
    const chipsEl = container.querySelector('[data-pms-chips]');
    const hiddenEl = container.querySelector('[data-pms-hidden]');
    chipsEl.innerHTML = [...selected].map(username => {
      // Người đã chọn từ trước có thể không còn nằm trong "candidates" đã lọc (VD tài khoản vừa bị khoá,
      // xem Yêu cầu 1) — vẫn tra thêm ở DB.users để hiện tên đẹp thay vì chỉ hiện username thô.
      const u = candidates.find(x => x.username === username) || (DB.users || []).find(x => x.username === username);
      return `
        <span class="inline-flex items-center gap-1 bg-rose-100 text-rose-700 rounded-full px-2 py-0.5 text-[11px]">
          ${escapeHtml(u ? label(u) : username)}
          <button type="button" data-op="pmsRemove" data-arg0="${escapeHtml(containerId)}" data-arg1="${escapeHtml(username)}" class="font-bold hover:text-rose-900">×</button>
        </span>
      `;
    }).join('') || '<span class="text-gray-400 italic text-[11px]">Chưa chọn ai.</span>';

    hiddenEl.innerHTML = [...selected].map(username =>
      `<input type="checkbox" class="${checkboxClass || ''}" ${dataAttrsStr} value="${escapeHtml(username)}" checked style="display:none">`
    ).join('');
  }

  function renderDropdown(query) {
    const ddEl = container.querySelector('[data-pms-dropdown]');
    // Bỏ dấu tiếng Việt trước khi so khớp (query lẫn label) — cùng cách xử lý vừa thêm ở sddRenderRows().
    const q = stripVnDiacritics((query || '').trim().toLowerCase());
    const matches = candidates.filter(u => !selected.has(u.username) && (!q || stripVnDiacritics(label(u).toLowerCase()).includes(q))).slice(0, 30);
    ddEl.innerHTML = matches.length
      ? matches.map(u => `<div class="px-2 py-1 text-[11px] hover:bg-rose-50 cursor-pointer" data-op="pmsAdd" data-arg0="${escapeHtml(containerId)}" data-arg1="${escapeHtml(u.username)}">${escapeHtml(label(u))}</div>`).join('')
      : '<div class="px-2 py-1 text-[11px] text-gray-400 italic">Không tìm thấy.</div>';
    ddEl.classList.remove('hidden');
  }

  container.setAttribute('data-pms-root', '');
  container.innerHTML = `
    <div data-pms-chips class="flex flex-wrap gap-1 mb-1"></div>
    <div class="relative">
      <input type="text" data-pms-search placeholder="Tìm theo tên/username/phòng ban để thêm..." class="w-full border p-1.5 rounded text-[11px]"
        data-op-input="pmsFilter" data-arg0="${escapeHtml(containerId)}" data-arg-value="1" onfocus="pmsFilter('${containerId}', this.value)">
      <div data-pms-dropdown class="hidden absolute z-20 bg-white border rounded shadow max-h-40 overflow-y-auto w-full mt-0.5"></div>
    </div>
    <div data-pms-hidden></div>
  `;
  container._pmsCandidates = candidates;
  container._pmsSelected = selected;
  container._pmsRenderChips = renderChips;
  container._pmsRenderDropdown = renderDropdown;
  renderChips();
}
function pmsFilter(containerId, query) { document.getElementById(containerId)?._pmsRenderDropdown(query); }
function pmsAdd(containerId, username) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container._pmsSelected.add(username);
  container._pmsRenderChips();
  const search = container.querySelector('[data-pms-search]');
  search.value = '';
  container._pmsRenderDropdown('');
  search.focus();
}
function pmsRemove(containerId, username) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container._pmsSelected.delete(username);
  container._pmsRenderChips();
}
function pmsClear(containerId) {
  const container = document.getElementById(containerId);
  if (!container || !container._pmsSelected) return;
  container._pmsSelected.clear();
  container._pmsRenderChips();
}
// Đóng dropdown đang mở khi click ra ngoài — gắn 1 LẦN DUY NHẤT ở top-level (không gắn lại mỗi lần
// render, tránh chồng listener) — tự áp dụng cho MỌI khối renderPeopleMultiSelect đang có trên trang
// nhờ query lại theo [data-pms-root] mỗi lần click thay vì nhớ tham chiếu cố định.
document.addEventListener('click', (ev) => {
  document.querySelectorAll('[data-pms-root]').forEach(root => {
    if (!root.contains(ev.target)) root.querySelector('[data-pms-dropdown]')?.classList.add('hidden');
  });
});


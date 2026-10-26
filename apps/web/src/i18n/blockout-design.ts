export const blockoutDesignEn = {
  'blockout.designLoadFailed': 'The saved design could not be checked. Close and reopen the editor before sending an update.',
  'blockout.underlayUnavailable': 'The design reference is unavailable for this page.',
  'blockout.designSourceChanged': 'Design files have changed since the saved composition. The agent will need to reconcile them before applying your edits.',
  'blockout.designPendingHint': 'Composition edits autosave here. The finished design changes after you send the update to the agent.',
  'blockout.designRegistrationMissing': 'Composition approved. No completed design is linked yet. You can edit the blocks or continue the design in chat.',
  'blockout.designRegistrationPending': 'The agent has registered a design that is still being checked. You can keep editing; it becomes the reference only after a successful result.',
  'blockout.designRegistrationFailed': 'The last design could not become a verified reference. Your composition is saved; continue in chat to finish or retry the design.',
  'blockout.showDesignReference': 'Show finished design as a guide',
  'blockout.updateDesign': 'Update the design',
  'blockout.designEditRequest': 'Revise the design of «{title}» using my edited composition and feedback. Compare the applied design with the attached target; keep unaffected content and use the allowed flexibility to improve the graphic result. Watermarks and backgrounds may span the page.',
  'blockout.editComposition': 'Edit page composition',
  'blockout.backgroundIntent': 'Background and watermark',
  'blockout.backgroundIntentHint': 'Page-wide direction. Backgrounds can extend behind several blocks; no extra rectangle is needed.',
};
export type BlockoutDesignDict = typeof blockoutDesignEn;

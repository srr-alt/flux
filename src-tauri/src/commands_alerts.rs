use tauri::State;

use crate::alerts::{ActiveAlert, AlertEventRow, AlertRule, AlertsState};

#[tauri::command]
pub fn alerts_list_rules(state: State<'_, AlertsState>) -> Vec<AlertRule> {
    state.0.rules()
}

/// Upsert a rule (empty id = create). Returns the full rule list.
#[tauri::command]
pub fn alerts_save_rule(
    state: State<'_, AlertsState>,
    rule: AlertRule,
) -> Result<Vec<AlertRule>, String> {
    state.0.save_rule(rule)
}

#[tauri::command]
pub fn alerts_delete_rule(
    state: State<'_, AlertsState>,
    id: String,
) -> Result<Vec<AlertRule>, String> {
    state.0.delete_rule(&id)
}

#[tauri::command]
pub fn alerts_active(state: State<'_, AlertsState>) -> Vec<ActiveAlert> {
    state.0.active()
}

#[tauri::command]
pub fn alerts_events(
    state: State<'_, AlertsState>,
    limit: u32,
) -> Result<Vec<AlertEventRow>, String> {
    state.0.events(limit)
}

#[tauri::command]
pub fn alerts_test_notification(state: State<'_, AlertsState>) -> Result<(), String> {
    state.0.test_notification()
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      absence_details: {
        Row: {
          absence_id: string
          document_name: string | null
          document_path: string | null
          document_size: number | null
          document_type: string | null
          organization_id: string
          reason: string | null
        }
        Insert: {
          absence_id: string
          document_name?: string | null
          document_path?: string | null
          document_size?: number | null
          document_type?: string | null
          organization_id: string
          reason?: string | null
        }
        Update: {
          absence_id?: string
          document_name?: string | null
          document_path?: string | null
          document_size?: number | null
          document_type?: string | null
          organization_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "absence_details_organization_id_absence_id_fkey"
            columns: ["organization_id", "absence_id"]
            isOneToOne: false
            referencedRelation: "absences"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      absences: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          employee_id: string
          end_date: string | null
          id: string
          idempotency_key: string | null
          interruption_decided_at: string | null
          interruption_decided_by: string | null
          interruption_decision_note: string | null
          interruption_end_date: string | null
          interruption_note: string | null
          interruption_requested_at: string | null
          interruption_requested_by: string | null
          interruption_status: string | null
          kind: string
          note: string | null
          organization_id: string
          requested_at: string
          requested_by: string | null
          start_date: string
          status: string
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_id: string
          end_date?: string | null
          id?: string
          idempotency_key?: string | null
          interruption_decided_at?: string | null
          interruption_decided_by?: string | null
          interruption_decision_note?: string | null
          interruption_end_date?: string | null
          interruption_note?: string | null
          interruption_requested_at?: string | null
          interruption_requested_by?: string | null
          interruption_status?: string | null
          kind: string
          note?: string | null
          organization_id: string
          requested_at?: string
          requested_by?: string | null
          start_date: string
          status: string
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_id?: string
          end_date?: string | null
          id?: string
          idempotency_key?: string | null
          interruption_decided_at?: string | null
          interruption_decided_by?: string | null
          interruption_decision_note?: string | null
          interruption_end_date?: string | null
          interruption_note?: string | null
          interruption_requested_at?: string | null
          interruption_requested_by?: string | null
          interruption_status?: string | null
          kind?: string
          note?: string | null
          organization_id?: string
          requested_at?: string
          requested_by?: string | null
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "absences_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "absences_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      attendance_alerts: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          kind: string
          note: string | null
          organization_id: string
          resolved_at: string | null
          resolved_by: string | null
          session_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          kind: string
          note?: string | null
          organization_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          session_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          kind?: string
          note?: string | null
          organization_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_alerts_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attendance_alerts_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attendance_alerts_organization_id_session_id_fkey"
            columns: ["organization_id", "session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      attendance_corrections: {
        Row: {
          clock_in_at: string
          clock_out_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          employee_id: string
          id: string
          idempotency_key: string | null
          new_session_id: string | null
          organization_id: string
          reason: string
          requested_at: string
          requested_by: string | null
          session_id: string | null
          status: string
        }
        Insert: {
          clock_in_at: string
          clock_out_at: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_id: string
          id?: string
          idempotency_key?: string | null
          new_session_id?: string | null
          organization_id: string
          reason: string
          requested_at?: string
          requested_by?: string | null
          session_id?: string | null
          status: string
        }
        Update: {
          clock_in_at?: string
          clock_out_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_id?: string
          id?: string
          idempotency_key?: string | null
          new_session_id?: string | null
          organization_id?: string
          reason?: string
          requested_at?: string
          requested_by?: string | null
          session_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_corrections_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attendance_corrections_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attendance_corrections_organization_id_new_session_id_fkey"
            columns: ["organization_id", "new_session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attendance_corrections_organization_id_session_id_fkey"
            columns: ["organization_id", "session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      attendance_kiosks: {
        Row: {
          activated_at: string | null
          activation_code_hash: string | null
          activation_expires_at: string | null
          created_at: string
          created_by: string | null
          id: string
          last_seen_at: string | null
          name: string
          organization_id: string
          revoked_at: string | null
          secret_hash: string | null
        }
        Insert: {
          activated_at?: string | null
          activation_code_hash?: string | null
          activation_expires_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_seen_at?: string | null
          name: string
          organization_id: string
          revoked_at?: string | null
          secret_hash?: string | null
        }
        Update: {
          activated_at?: string | null
          activation_code_hash?: string | null
          activation_expires_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_seen_at?: string | null
          name?: string
          organization_id?: string
          revoked_at?: string | null
          secret_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_kiosks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sessions: {
        Row: {
          archived_at: string | null
          breaks: Json
          clock_in_at: string
          clock_in_by: string | null
          clock_in_source: string
          clock_out_at: string | null
          clock_out_by: string | null
          clock_out_key: string | null
          clock_out_source: string | null
          created_at: string
          employee_id: string
          id: string
          idempotency_key: string
          organization_id: string
          scheduled_end: string | null
          scheduled_start: string | null
          shift_id: string | null
          work_date: string
        }
        Insert: {
          archived_at?: string | null
          breaks?: Json
          clock_in_at?: string
          clock_in_by?: string | null
          clock_in_source: string
          clock_out_at?: string | null
          clock_out_by?: string | null
          clock_out_key?: string | null
          clock_out_source?: string | null
          created_at?: string
          employee_id: string
          id?: string
          idempotency_key: string
          organization_id: string
          scheduled_end?: string | null
          scheduled_start?: string | null
          shift_id?: string | null
          work_date: string
        }
        Update: {
          archived_at?: string | null
          breaks?: Json
          clock_in_at?: string
          clock_in_by?: string | null
          clock_in_source?: string
          clock_out_at?: string | null
          clock_out_by?: string | null
          clock_out_key?: string | null
          clock_out_source?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          scheduled_end?: string | null
          scheduled_start?: string | null
          shift_id?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attendance_sessions_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "attendance_sessions_organization_id_shift_id_fkey"
            columns: ["organization_id", "shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      attendance_settings: {
        Row: {
          absent_after_min: number
          auto_close_after_hours: number
          early_window_min: number
          holiday_pct: number
          late_tolerance_min: number
          leave_base_days: number
          leave_extra_days: number
          leave_extra_every_years: number
          leave_max_days: number
          leave_probation_months: number
          night_end: string
          night_pct: number
          night_start: string
          operation_without_clock_in: string
          organization_id: string
          overtime_mode: string
          overtime_pct: number
          overtime_step_min: number
          updated_at: string
          weekend_days: number[]
          weekend_pct: number
          weekly_hours: number
          weekly_overtime_warning_hours: number
        }
        Insert: {
          absent_after_min?: number
          auto_close_after_hours?: number
          early_window_min?: number
          holiday_pct?: number
          late_tolerance_min?: number
          leave_base_days?: number
          leave_extra_days?: number
          leave_extra_every_years?: number
          leave_max_days?: number
          leave_probation_months?: number
          night_end?: string
          night_pct?: number
          night_start?: string
          operation_without_clock_in?: string
          organization_id: string
          overtime_mode?: string
          overtime_pct?: number
          overtime_step_min?: number
          updated_at?: string
          weekend_days?: number[]
          weekend_pct?: number
          weekly_hours?: number
          weekly_overtime_warning_hours?: number
        }
        Update: {
          absent_after_min?: number
          auto_close_after_hours?: number
          early_window_min?: number
          holiday_pct?: number
          late_tolerance_min?: number
          leave_base_days?: number
          leave_extra_days?: number
          leave_extra_every_years?: number
          leave_max_days?: number
          leave_probation_months?: number
          night_end?: string
          night_pct?: number
          night_start?: string
          operation_without_clock_in?: string
          organization_id?: string
          overtime_mode?: string
          overtime_pct?: number
          overtime_step_min?: number
          updated_at?: string
          weekend_days?: number[]
          weekend_pct?: number
          weekly_hours?: number
          weekly_overtime_warning_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "attendance_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          organization_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          organization_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          kind: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          kind: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          activity: string | null
          address: string | null
          city: string | null
          country: string
          created_at: string
          created_by_organization_id: string | null
          email: string | null
          id: string
          legal_form: string | null
          mail_address: string | null
          mail_city: string | null
          mail_postal_code: string | null
          name: string
          owner_organization_id: string | null
          phone: string | null
          postal_code: string | null
          short_name: string | null
          tax_id: string
          updated_at: string
          vat_id: string | null
          website: string | null
        }
        Insert: {
          activity?: string | null
          address?: string | null
          city?: string | null
          country: string
          created_at?: string
          created_by_organization_id?: string | null
          email?: string | null
          id?: string
          legal_form?: string | null
          mail_address?: string | null
          mail_city?: string | null
          mail_postal_code?: string | null
          name: string
          owner_organization_id?: string | null
          phone?: string | null
          postal_code?: string | null
          short_name?: string | null
          tax_id: string
          updated_at?: string
          vat_id?: string | null
          website?: string | null
        }
        Update: {
          activity?: string | null
          address?: string | null
          city?: string | null
          country?: string
          created_at?: string
          created_by_organization_id?: string | null
          email?: string | null
          id?: string
          legal_form?: string | null
          mail_address?: string | null
          mail_city?: string | null
          mail_postal_code?: string | null
          name?: string
          owner_organization_id?: string | null
          phone?: string | null
          postal_code?: string | null
          short_name?: string | null
          tax_id?: string
          updated_at?: string
          vat_id?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_created_by_organization_id_fkey"
            columns: ["created_by_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_bank_accounts: {
        Row: {
          account_number: string | null
          archived_at: string | null
          bank_name: string
          company_id: string
          created_at: string
          iban: string | null
          id: string
          is_primary: boolean
          sort_order: number
          swift: string | null
        }
        Insert: {
          account_number?: string | null
          archived_at?: string | null
          bank_name: string
          company_id: string
          created_at?: string
          iban?: string | null
          id?: string
          is_primary?: boolean
          sort_order?: number
          swift?: string | null
        }
        Update: {
          account_number?: string | null
          archived_at?: string | null
          bank_name?: string
          company_id?: string
          created_at?: string
          iban?: string | null
          id?: string
          is_primary?: boolean
          sort_order?: number
          swift?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_change_requests: {
        Row: {
          bank_accounts: Json | null
          changes: Json
          company_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          kind: string
          reason: string | null
          requested_by_organization_id: string
          requested_by_user_id: string | null
          status: string
        }
        Insert: {
          bank_accounts?: Json | null
          changes?: Json
          company_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          kind?: string
          reason?: string | null
          requested_by_organization_id: string
          requested_by_user_id?: string | null
          status?: string
        }
        Update: {
          bank_accounts?: Json | null
          changes?: Json
          company_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          kind?: string
          reason?: string | null
          requested_by_organization_id?: string
          requested_by_user_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_change_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_change_requests_requested_by_organization_id_fkey"
            columns: ["requested_by_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          archived_at: string | null
          city: string | null
          company_id: string | null
          contact_person: string | null
          country: string | null
          created_at: string
          customer_number: number
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          postal_code: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          city?: string | null
          company_id?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          customer_number?: number
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          city?: string | null
          company_id?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          customer_number?: number
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_holiday_keys: {
        Row: {
          employee_id: string
          key: string
          organization_id: string
        }
        Insert: {
          employee_id: string
          key: string
          organization_id: string
        }
        Update: {
          employee_id?: string
          key?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_holiday_keys_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_holiday_keys_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      employee_hourly_rates: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          organization_id: string
          rate: number
          valid_from: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          organization_id: string
          rate: number
          valid_from: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          organization_id?: string
          rate?: number
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_hourly_rates_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_hourly_rates_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      employee_kiosk_credentials: {
        Row: {
          badge_issued_at: string | null
          badge_token: string | null
          employee_id: string
          failed_attempts: number
          locked_until: string | null
          organization_id: string
          pin_hash: string | null
          pin_set_at: string | null
        }
        Insert: {
          badge_issued_at?: string | null
          badge_token?: string | null
          employee_id: string
          failed_attempts?: number
          locked_until?: string | null
          organization_id: string
          pin_hash?: string | null
          pin_set_at?: string | null
        }
        Update: {
          badge_issued_at?: string | null
          badge_token?: string | null
          employee_id?: string
          failed_attempts?: number
          locked_until?: string | null
          organization_id?: string
          pin_hash?: string | null
          pin_set_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_kiosk_credentials_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_kiosk_credentials_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      employee_leave_years: {
        Row: {
          carried_over_days: number
          employee_id: string
          entitlement_override: number | null
          organization_id: string
          updated_at: string
          year: number
        }
        Insert: {
          carried_over_days?: number
          employee_id: string
          entitlement_override?: number | null
          organization_id: string
          updated_at?: string
          year: number
        }
        Update: {
          carried_over_days?: number
          employee_id?: string
          entitlement_override?: number | null
          organization_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_leave_years_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_leave_years_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      employee_machines: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          machine_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          machine_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          machine_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_machines_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_machines_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_machines_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machine_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_machines_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      employee_skills: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          level: number
          organization_id: string
          skill_id: string
          skill_kind: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          level: number
          organization_id: string
          skill_id: string
          skill_kind?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          level?: number
          organization_id?: string
          skill_id?: string
          skill_kind?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_skills_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_skills_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_skills_organization_id_skill_kind_skill_id_fkey"
            columns: ["organization_id", "skill_kind", "skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "kind", "id"]
          },
        ]
      }
      employee_work_info: {
        Row: {
          employee_id: string
          hired_on: string | null
          organization_id: string
          prior_service_months: number
          updated_at: string
          weekend_days: number[] | null
        }
        Insert: {
          employee_id: string
          hired_on?: string | null
          organization_id: string
          prior_service_months?: number
          updated_at?: string
          weekend_days?: number[] | null
        }
        Update: {
          employee_id?: string
          hired_on?: string | null
          organization_id?: string
          prior_service_months?: number
          updated_at?: string
          weekend_days?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_work_info_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "employee_work_info_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      employees: {
        Row: {
          archived_at: string | null
          created_at: string
          department_id: string | null
          department_kind: string | null
          employee_number: number
          first_name: string
          id: string
          job_title_id: string | null
          job_title_kind: string | null
          last_name: string
          organization_id: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          department_id?: string | null
          department_kind?: string | null
          employee_number: number
          first_name: string
          id?: string
          job_title_id?: string | null
          job_title_kind?: string | null
          last_name: string
          organization_id: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          department_id?: string | null
          department_kind?: string | null
          employee_number?: number
          first_name?: string
          id?: string
          job_title_id?: string | null
          job_title_kind?: string | null
          last_name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_organization_id_department_kind_department_id_fkey"
            columns: ["organization_id", "department_kind", "department_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "kind", "id"]
          },
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_organization_id_job_title_kind_job_title_id_fkey"
            columns: ["organization_id", "job_title_kind", "job_title_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "kind", "id"]
          },
          {
            foreignKeyName: "employees_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      holiday_templates: {
        Row: {
          confirmed: boolean
          date: string
          id: string
          key: string
          kind: string
          name: string
        }
        Insert: {
          confirmed?: boolean
          date: string
          id?: string
          key: string
          kind: string
          name: string
        }
        Update: {
          confirmed?: boolean
          date?: string
          id?: string
          key?: string
          kind?: string
          name?: string
        }
        Relationships: []
      }
      machines: {
        Row: {
          archived_at: string | null
          code: string
          created_at: string
          cycle_time_unit: string | null
          id: string
          location_id: string | null
          location_kind: string | null
          manufacturer: string | null
          model: string | null
          name: string
          notes: string | null
          organization_id: string
          status: string
          status_changed_at: string
          status_changed_by: string | null
          type_id: string | null
          type_kind: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          code: string
          created_at?: string
          cycle_time_unit?: string | null
          id?: string
          location_id?: string | null
          location_kind?: string | null
          manufacturer?: string | null
          model?: string | null
          name: string
          notes?: string | null
          organization_id: string
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          type_id?: string | null
          type_kind?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          code?: string
          created_at?: string
          cycle_time_unit?: string | null
          id?: string
          location_id?: string | null
          location_kind?: string | null
          manufacturer?: string | null
          model?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          type_id?: string | null
          type_kind?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "machines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machines_organization_id_location_kind_location_id_fkey"
            columns: ["organization_id", "location_kind", "location_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "kind", "id"]
          },
          {
            foreignKeyName: "machines_organization_id_type_kind_type_id_fkey"
            columns: ["organization_id", "type_kind", "type_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "kind", "id"]
          },
        ]
      }
      material_groups: {
        Row: {
          archived_at: string | null
          created_at: string
          density_kg_dm3: number | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          density_kg_dm3?: number | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          density_kg_dm3?: number | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          archived_at: string | null
          created_at: string
          density_kg_dm3: number | null
          designation: string
          group_id: string
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          density_kg_dm3?: number | null
          designation: string
          group_id: string
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          density_kg_dm3?: number | null
          designation?: string
          group_id?: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "materials_organization_id_group_id_fkey"
            columns: ["organization_id", "group_id"]
            isOneToOne: false
            referencedRelation: "material_groups"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      memberships: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          organization_id: string
          role_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          organization_id: string
          role_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          role_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_organization_id_role_id_fkey"
            columns: ["organization_id", "role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "memberships_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      modules: {
        Row: {
          created_at: string
          key: string
          name: string
        }
        Insert: {
          created_at?: string
          key: string
          name: string
        }
        Update: {
          created_at?: string
          key?: string
          name?: string
        }
        Relationships: []
      }
      operation_types: {
        Row: {
          archived_at: string | null
          code: string
          created_at: string
          id: string
          is_cutting: boolean
          is_external: boolean
          is_inspection: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          code: string
          created_at?: string
          id?: string
          is_cutting?: boolean
          is_external?: boolean
          is_inspection?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          code?: string
          created_at?: string
          id?: string
          is_cutting?: boolean
          is_external?: boolean
          is_inspection?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_holiday_rules: {
        Row: {
          key: string
          organization_id: string
          scope: string
        }
        Insert: {
          key: string
          organization_id: string
          scope: string
        }
        Update: {
          key?: string
          organization_id?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_holiday_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_holidays: {
        Row: {
          archived_at: string | null
          confirmed: boolean
          created_at: string
          date: string
          id: string
          key: string
          kind: string
          name: string
          organization_id: string
        }
        Insert: {
          archived_at?: string | null
          confirmed?: boolean
          created_at?: string
          date: string
          id?: string
          key: string
          kind: string
          name: string
          organization_id: string
        }
        Update: {
          archived_at?: string | null
          confirmed?: boolean
          created_at?: string
          date?: string
          id?: string
          key?: string
          kind?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_holidays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_modules: {
        Row: {
          active_until: string | null
          created_at: string
          enabled: boolean
          enabled_at: string | null
          module_key: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          active_until?: string | null
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          module_key: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          active_until?: string | null
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          module_key?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_modules_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "org_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          archived_at: string | null
          company_id: string | null
          created_at: string
          id: string
          is_platform: boolean
          name: string
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          is_platform?: boolean
          name: string
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          is_platform?: boolean
          name?: string
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_settings: {
        Row: {
          default_hourly_rate: number | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          default_hourly_rate?: number | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          default_hourly_rate?: number | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          created_at: string
          default_roles: string[]
          description: string
          key: string
          module_key: string
        }
        Insert: {
          created_at?: string
          default_roles?: string[]
          description: string
          key: string
          module_key: string
        }
        Update: {
          created_at?: string
          default_roles?: string[]
          description?: string
          key?: string
          module_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "permissions_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
        ]
      }
      platform_settings: {
        Row: {
          default_trial_days: number
          id: boolean
          updated_at: string
        }
        Insert: {
          default_trial_days?: number
          id?: boolean
          updated_at?: string
        }
        Update: {
          default_trial_days?: number
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      product_attachments: {
        Row: {
          archived_at: string | null
          content_type: string
          created_at: string
          created_by: string | null
          file_name: string
          id: string
          kind: string
          main_drawing_id: string | null
          operation_id: string | null
          organization_id: string
          revision_id: string
          size_bytes: number
          storage_path: string
          title: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          content_type: string
          created_at?: string
          created_by?: string | null
          file_name: string
          id?: string
          kind: string
          main_drawing_id?: string | null
          operation_id?: string | null
          organization_id: string
          revision_id: string
          size_bytes: number
          storage_path: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          file_name?: string
          id?: string
          kind?: string
          main_drawing_id?: string | null
          operation_id?: string | null
          organization_id?: string
          revision_id?: string
          size_bytes?: number
          storage_path?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_attachments_organization_id_main_drawing_id_fkey"
            columns: ["organization_id", "main_drawing_id"]
            isOneToOne: false
            referencedRelation: "product_attachments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_attachments_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "product_operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_attachments_organization_id_revision_id_fkey"
            columns: ["organization_id", "revision_id"]
            isOneToOne: false
            referencedRelation: "product_revisions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      product_operations: {
        Row: {
          archived_at: string | null
          auto_inspection: boolean
          created_at: string
          cycle_time_s: number | null
          description: string | null
          external_company: string | null
          id: string
          machine_id: string | null
          machine_type_id: string | null
          machine_type_kind: string | null
          notes: string | null
          operation_type_id: string
          organization_id: string
          revision_id: string
          sequence: number
          setup_time_min: number | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          auto_inspection?: boolean
          created_at?: string
          cycle_time_s?: number | null
          description?: string | null
          external_company?: string | null
          id?: string
          machine_id?: string | null
          machine_type_id?: string | null
          machine_type_kind?: string | null
          notes?: string | null
          operation_type_id: string
          organization_id: string
          revision_id: string
          sequence: number
          setup_time_min?: number | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          auto_inspection?: boolean
          created_at?: string
          cycle_time_s?: number | null
          description?: string | null
          external_company?: string | null
          id?: string
          machine_id?: string | null
          machine_type_id?: string | null
          machine_type_kind?: string | null
          notes?: string | null
          operation_type_id?: string
          organization_id?: string
          revision_id?: string
          sequence?: number
          setup_time_min?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_operations_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machine_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_operations_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_operations_organization_id_machine_type_kind_machi_fkey"
            columns: ["organization_id", "machine_type_kind", "machine_type_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "kind", "id"]
          },
          {
            foreignKeyName: "product_operations_organization_id_operation_type_id_fkey"
            columns: ["organization_id", "operation_type_id"]
            isOneToOne: false
            referencedRelation: "operation_types"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_operations_organization_id_revision_id_fkey"
            columns: ["organization_id", "revision_id"]
            isOneToOne: false
            referencedRelation: "product_revisions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      product_revisions: {
        Row: {
          blank_diameter_mm: number | null
          blank_geometry: string | null
          blank_thickness_mm: number | null
          blank_width_mm: number | null
          created_at: string
          created_by: string | null
          cut_length_mm: number | null
          description: string | null
          drawing_number: string | null
          id: string
          is_current: boolean
          kerf_mm: number | null
          material_id: string | null
          net_mass_kg: number | null
          organization_id: string
          product_id: string
          revision: string | null
          updated_at: string
        }
        Insert: {
          blank_diameter_mm?: number | null
          blank_geometry?: string | null
          blank_thickness_mm?: number | null
          blank_width_mm?: number | null
          created_at?: string
          created_by?: string | null
          cut_length_mm?: number | null
          description?: string | null
          drawing_number?: string | null
          id?: string
          is_current?: boolean
          kerf_mm?: number | null
          material_id?: string | null
          net_mass_kg?: number | null
          organization_id: string
          product_id: string
          revision?: string | null
          updated_at?: string
        }
        Update: {
          blank_diameter_mm?: number | null
          blank_geometry?: string | null
          blank_thickness_mm?: number | null
          blank_width_mm?: number | null
          created_at?: string
          created_by?: string | null
          cut_length_mm?: number | null
          description?: string | null
          drawing_number?: string | null
          id?: string
          is_current?: boolean
          kerf_mm?: number | null
          material_id?: string | null
          net_mass_kg?: number | null
          organization_id?: string
          product_id?: string
          revision?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_revisions_material_fkey"
            columns: ["organization_id", "material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_revisions_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_revisions_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      production_downtime_events: {
        Row: {
          employee_id: string | null
          ended_at: string | null
          id: string
          idempotency_key: string | null
          machine_id: string | null
          notes: string | null
          operation_id: string
          order_id: string
          organization_id: string
          reason_id: string
          reason_kind: string | null
          reported_by: string | null
          source: string
          started_at: string
        }
        Insert: {
          employee_id?: string | null
          ended_at?: string | null
          id?: string
          idempotency_key?: string | null
          machine_id?: string | null
          notes?: string | null
          operation_id: string
          order_id: string
          organization_id: string
          reason_id: string
          reason_kind?: string | null
          reported_by?: string | null
          source?: string
          started_at?: string
        }
        Update: {
          employee_id?: string | null
          ended_at?: string | null
          id?: string
          idempotency_key?: string | null
          machine_id?: string | null
          notes?: string | null
          operation_id?: string
          order_id?: string
          organization_id?: string
          reason_id?: string
          reason_kind?: string | null
          reported_by?: string | null
          source?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_downtime_events_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_downtime_events_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_downtime_events_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machine_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_downtime_events_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_downtime_events_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operation_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_downtime_events_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_downtime_events_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_order_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_downtime_events_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_downtime_events_organization_id_reason_kind_rea_fkey"
            columns: ["organization_id", "reason_kind", "reason_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "kind", "id"]
          },
        ]
      }
      production_order_attachments: {
        Row: {
          archived_at: string | null
          attachment_id: string
          created_at: string
          id: string
          order_id: string
          organization_id: string
        }
        Insert: {
          archived_at?: string | null
          attachment_id: string
          created_at?: string
          id?: string
          order_id: string
          organization_id: string
        }
        Update: {
          archived_at?: string | null
          attachment_id?: string
          created_at?: string
          id?: string
          order_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_order_attachments_organization_id_attachment_id_fkey"
            columns: ["organization_id", "attachment_id"]
            isOneToOne: false
            referencedRelation: "product_attachments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_attachments_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_order_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_attachments_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      production_order_close_requests: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          good_quantity: number
          id: string
          order_id: string
          organization_id: string
          reason: string
          requested_at: string
          requested_by: string | null
          status: string
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          good_quantity: number
          id?: string
          order_id: string
          organization_id: string
          reason: string
          requested_at?: string
          requested_by?: string | null
          status?: string
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          good_quantity?: number
          id?: string
          order_id?: string
          organization_id?: string
          reason?: string
          requested_at?: string
          requested_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_order_close_requests_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_order_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_close_requests_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      production_order_operation_workers: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          operation_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          operation_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          operation_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_order_operation_wo_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operation_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_operation_wo_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_operation_wor_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_operation_wor_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      production_order_operations: {
        Row: {
          archived_at: string | null
          created_at: string
          cycle_time_s: number | null
          description: string | null
          external_company: string | null
          id: string
          machine_id: string | null
          machine_type_id: string | null
          machine_type_kind: string | null
          notes: string | null
          operation_type_id: string
          order_id: string
          organization_id: string
          planned_end: string | null
          planned_start: string | null
          sequence: number
          setup_time_min: number | null
          source_operation_id: string | null
          status: string
          status_changed_at: string
          status_changed_by: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          cycle_time_s?: number | null
          description?: string | null
          external_company?: string | null
          id?: string
          machine_id?: string | null
          machine_type_id?: string | null
          machine_type_kind?: string | null
          notes?: string | null
          operation_type_id: string
          order_id: string
          organization_id: string
          planned_end?: string | null
          planned_start?: string | null
          sequence: number
          setup_time_min?: number | null
          source_operation_id?: string | null
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          cycle_time_s?: number | null
          description?: string | null
          external_company?: string | null
          id?: string
          machine_id?: string | null
          machine_type_id?: string | null
          machine_type_kind?: string | null
          notes?: string | null
          operation_type_id?: string
          order_id?: string
          organization_id?: string
          planned_end?: string | null
          planned_start?: string | null
          sequence?: number
          setup_time_min?: number | null
          source_operation_id?: string | null
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_order_operations_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machine_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_operations_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_operations_organization_id_machine_type_k_fkey"
            columns: ["organization_id", "machine_type_kind", "machine_type_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "kind", "id"]
          },
          {
            foreignKeyName: "production_order_operations_organization_id_operation_type_fkey"
            columns: ["organization_id", "operation_type_id"]
            isOneToOne: false
            referencedRelation: "operation_types"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_operations_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_order_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_operations_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      production_order_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: string | null
          id: number
          operation_id: string | null
          order_id: string
          organization_id: string
          reason: string | null
          to_status: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: string | null
          id?: never
          operation_id?: string | null
          order_id: string
          organization_id: string
          reason?: string | null
          to_status: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: string | null
          id?: never
          operation_id?: string | null
          order_id?: string
          organization_id?: string
          reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_order_status_histo_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operation_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_status_histo_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_status_history_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_order_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_status_history_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      production_orders: {
        Row: {
          archived_at: string | null
          bar_length_mm: number | null
          bar_remnant_mm: number | null
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          due_date: string
          id: string
          kerf_mm: number | null
          notes: string | null
          order_number: string
          order_sequence: number
          order_year: number
          organization_id: string
          piece_length_mm: number | null
          planned_end: string | null
          planned_start: string | null
          priority: number | null
          product_id: string
          quantity: number
          revision_id: string
          source_order_id: string | null
          status: string
          status_changed_at: string
          status_changed_by: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          bar_length_mm?: number | null
          bar_remnant_mm?: number | null
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          due_date: string
          id?: string
          kerf_mm?: number | null
          notes?: string | null
          order_number: string
          order_sequence: number
          order_year: number
          organization_id: string
          piece_length_mm?: number | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: number | null
          product_id: string
          quantity: number
          revision_id: string
          source_order_id?: string | null
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          unit: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          bar_length_mm?: number | null
          bar_remnant_mm?: number | null
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          due_date?: string
          id?: string
          kerf_mm?: number | null
          notes?: string | null
          order_number?: string
          order_sequence?: number
          order_year?: number
          organization_id?: string
          piece_length_mm?: number | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: number | null
          product_id?: string
          quantity?: number
          revision_id?: string
          source_order_id?: string | null
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_orders_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_orders_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_orders_organization_id_revision_id_fkey"
            columns: ["organization_id", "revision_id"]
            isOneToOne: false
            referencedRelation: "product_revisions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_orders_organization_id_source_order_id_fkey"
            columns: ["organization_id", "source_order_id"]
            isOneToOne: false
            referencedRelation: "production_order_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_orders_organization_id_source_order_id_fkey"
            columns: ["organization_id", "source_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      production_reports: {
        Row: {
          employee_id: string | null
          good_quantity: number
          id: string
          idempotency_key: string
          machine_id: string | null
          notes: string | null
          operation_id: string
          order_id: string
          organization_id: string
          reported_at: string
          reported_by: string | null
          scrap_quantity: number
          scrap_reason_id: string | null
          scrap_reason_kind: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          employee_id?: string | null
          good_quantity: number
          id?: string
          idempotency_key: string
          machine_id?: string | null
          notes?: string | null
          operation_id: string
          order_id: string
          organization_id: string
          reported_at?: string
          reported_by?: string | null
          scrap_quantity: number
          scrap_reason_id?: string | null
          scrap_reason_kind?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          employee_id?: string | null
          good_quantity?: number
          id?: string
          idempotency_key?: string
          machine_id?: string | null
          notes?: string | null
          operation_id?: string
          order_id?: string
          organization_id?: string
          reported_at?: string
          reported_by?: string | null
          scrap_quantity?: number
          scrap_reason_id?: string | null
          scrap_reason_kind?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_reports_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_reports_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_reports_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machine_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_reports_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_reports_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operation_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_reports_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_reports_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_order_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_reports_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_reports_organization_id_scrap_reason_kind_scrap_fkey"
            columns: ["organization_id", "scrap_reason_kind", "scrap_reason_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "kind", "id"]
          },
        ]
      }
      production_tool_changes: {
        Row: {
          changed_at: string
          duration_min: number | null
          employee_id: string | null
          id: string
          idempotency_key: string
          insert_name: string | null
          machine_id: string | null
          notes: string | null
          operation_id: string
          order_id: string
          organization_id: string
          reason_id: string
          reason_kind: string | null
          reported_by: string | null
          tool: string
        }
        Insert: {
          changed_at?: string
          duration_min?: number | null
          employee_id?: string | null
          id?: string
          idempotency_key: string
          insert_name?: string | null
          machine_id?: string | null
          notes?: string | null
          operation_id: string
          order_id: string
          organization_id: string
          reason_id: string
          reason_kind?: string | null
          reported_by?: string | null
          tool: string
        }
        Update: {
          changed_at?: string
          duration_min?: number | null
          employee_id?: string | null
          id?: string
          idempotency_key?: string
          insert_name?: string | null
          machine_id?: string | null
          notes?: string | null
          operation_id?: string
          order_id?: string
          organization_id?: string
          reason_id?: string
          reason_kind?: string | null
          reported_by?: string | null
          tool?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_tool_changes_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_tool_changes_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_tool_changes_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machine_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_tool_changes_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_tool_changes_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operation_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_tool_changes_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_tool_changes_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_order_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_tool_changes_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_tool_changes_organization_id_reason_kind_reason_fkey"
            columns: ["organization_id", "reason_kind", "reason_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "kind", "id"]
          },
        ]
      }
      production_work_sessions: {
        Row: {
          employee_id: string
          ended_at: string | null
          id: string
          machine_id: string | null
          operation_id: string
          order_id: string
          organization_id: string
          started_at: string
        }
        Insert: {
          employee_id: string
          ended_at?: string | null
          id?: string
          machine_id?: string | null
          operation_id: string
          order_id: string
          organization_id: string
          started_at?: string
        }
        Update: {
          employee_id?: string
          ended_at?: string | null
          id?: string
          machine_id?: string | null
          operation_id?: string
          order_id?: string
          organization_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_work_sessions_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_work_sessions_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_work_sessions_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machine_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_work_sessions_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_work_sessions_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operation_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_work_sessions_organization_id_operation_id_fkey"
            columns: ["organization_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "production_order_operations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_work_sessions_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_order_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_work_sessions_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          created_at: string
          customer_id: string | null
          id: string
          inspection_plan: string
          name: string
          organization_id: string
          part_number: string
          product_type_id: string | null
          product_type_kind: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          inspection_plan?: string
          name: string
          organization_id: string
          part_number: string
          product_type_id?: string | null
          product_type_kind?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          inspection_plan?: string
          name?: string
          organization_id?: string
          part_number?: string
          product_type_id?: string | null
          product_type_kind?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_customer_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_organization_id_product_type_kind_product_type_id_fkey"
            columns: ["organization_id", "product_type_kind", "product_type_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "kind", "id"]
          },
        ]
      }
      profiles: {
        Row: {
          archived_at: string | null
          created_at: string
          full_name: string | null
          id: string
          is_support: boolean
          must_change_password: boolean
          organization_id: string
          preferences: Json
          updated_at: string
          username: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          is_support?: boolean
          must_change_password?: boolean
          organization_id: string
          preferences?: Json
          updated_at?: string
          username: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_support?: boolean
          must_change_password?: boolean
          organization_id?: string
          preferences?: Json
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_attempts: {
        Row: {
          client_hash: string
          created_at: string
          id: number
          kind: string
        }
        Insert: {
          client_hash: string
          created_at?: string
          id?: never
          kind: string
        }
        Update: {
          client_hash?: string
          created_at?: string
          id?: never
          kind?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          organization_id: string
          permission_key: string
          role_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          permission_key: string
          role_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          permission_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_organization_id_role_id_fkey"
            columns: ["organization_id", "role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      roles: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          is_system: boolean
          key: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_system?: boolean
          key: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_breaks: {
        Row: {
          duration_min: number
          id: string
          name: string | null
          organization_id: string
          paid: boolean
          position: number
          shift_id: string
          starts_at: string | null
        }
        Insert: {
          duration_min: number
          id?: string
          name?: string | null
          organization_id: string
          paid?: boolean
          position: number
          shift_id: string
          starts_at?: string | null
        }
        Update: {
          duration_min?: number
          id?: string
          name?: string | null
          organization_id?: string
          paid?: boolean
          position?: number
          shift_id?: string
          starts_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_breaks_organization_id_shift_id_fkey"
            columns: ["organization_id", "shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      shift_crew_members: {
        Row: {
          crew_id: string
          employee_id: string
          organization_id: string
        }
        Insert: {
          crew_id: string
          employee_id: string
          organization_id: string
        }
        Update: {
          crew_id?: string
          employee_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_crew_members_organization_id_crew_id_fkey"
            columns: ["organization_id", "crew_id"]
            isOneToOne: false
            referencedRelation: "shift_crews"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "shift_crew_members_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: true
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "shift_crew_members_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      shift_crews: {
        Row: {
          archived_at: string | null
          color: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_crews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_rotation_assignments: {
        Row: {
          created_at: string
          crew_id: string | null
          employee_id: string | null
          end_date: string | null
          id: string
          organization_id: string
          rotation_id: string
          start_date: string
        }
        Insert: {
          created_at?: string
          crew_id?: string | null
          employee_id?: string | null
          end_date?: string | null
          id?: string
          organization_id: string
          rotation_id: string
          start_date: string
        }
        Update: {
          created_at?: string
          crew_id?: string | null
          employee_id?: string | null
          end_date?: string | null
          id?: string
          organization_id?: string
          rotation_id?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_rotation_assignments_organization_id_crew_id_fkey"
            columns: ["organization_id", "crew_id"]
            isOneToOne: false
            referencedRelation: "shift_crews"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "shift_rotation_assignments_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "shift_rotation_assignments_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "shift_rotation_assignments_organization_id_rotation_id_fkey"
            columns: ["organization_id", "rotation_id"]
            isOneToOne: false
            referencedRelation: "shift_rotations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      shift_rotation_days: {
        Row: {
          day_index: number
          organization_id: string
          rotation_id: string
          shift_id: string
        }
        Insert: {
          day_index: number
          organization_id: string
          rotation_id: string
          shift_id: string
        }
        Update: {
          day_index?: number
          organization_id?: string
          rotation_id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_rotation_days_organization_id_rotation_id_fkey"
            columns: ["organization_id", "rotation_id"]
            isOneToOne: false
            referencedRelation: "shift_rotations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "shift_rotation_days_organization_id_shift_id_fkey"
            columns: ["organization_id", "shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      shift_rotations: {
        Row: {
          archived_at: string | null
          created_at: string
          cycle_days: number
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          cycle_days: number
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          cycle_days?: number
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_rotations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_schedule: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          organization_id: string
          shift_id: string
          source: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          organization_id: string
          shift_id: string
          source?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          organization_id?: string
          shift_id?: string
          source?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_schedule_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "shift_schedule_organization_id_employee_id_fkey"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "shift_schedule_organization_id_shift_id_fkey"
            columns: ["organization_id", "shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      shifts: {
        Row: {
          archived_at: string | null
          code: string
          color: string | null
          created_at: string
          ends_at: string
          id: string
          name: string
          organization_id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          code: string
          color?: string | null
          created_at?: string
          ends_at: string
          id?: string
          name: string
          organization_id: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          code?: string
          color?: string | null
          created_at?: string
          ends_at?: string
          id?: string
          name?: string
          organization_id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_access_requests: {
        Row: {
          approved_until: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          duration_minutes: number | null
          ended_at: string | null
          ended_by: string | null
          id: string
          organization_id: string
          reason: string
          requested_by: string
          requester_name: string
          started_at: string | null
          status: string
        }
        Insert: {
          approved_until?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          organization_id: string
          reason: string
          requested_by: string
          requester_name: string
          started_at?: string | null
          status?: string
        }
        Update: {
          approved_until?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          organization_id?: string
          reason?: string
          requested_by?: string
          requester_name?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_access_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      employee_directory: {
        Row: {
          archived_at: string | null
          created_at: string | null
          department_id: string | null
          department_name: string | null
          employee_number: number | null
          employee_number_text: string | null
          first_name: string | null
          full_name: string | null
          id: string | null
          job_title_id: string | null
          job_title_name: string | null
          last_name: string | null
          machines: Json | null
          organization_id: string | null
          skills: Json | null
          status: string | null
          user_id: string | null
          username: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      machine_directory: {
        Row: {
          archived_at: string | null
          code: string | null
          created_at: string | null
          cycle_time_unit: string | null
          id: string | null
          location_id: string | null
          location_name: string | null
          manufacturer: string | null
          model: string | null
          name: string | null
          notes: string | null
          organization_id: string | null
          status: string | null
          status_changed_at: string | null
          type_id: string | null
          type_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "machines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_directory: {
        Row: {
          archived_at: string | null
          created_at: string | null
          full_name: string | null
          is_active: boolean | null
          must_change_password: boolean | null
          organization_id: string | null
          role_id: string | null
          role_key: string | null
          role_name: string | null
          user_id: string | null
          username: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_organization_id_role_id_fkey"
            columns: ["organization_id", "role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "memberships_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      product_directory: {
        Row: {
          archived_at: string | null
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          drawing_number: string | null
          id: string | null
          inspection_plan: string | null
          material_designation: string | null
          material_group_name: string | null
          material_id: string | null
          name: string | null
          operation_count: number | null
          organization_id: string | null
          part_number: string | null
          product_type_id: string | null
          product_type_name: string | null
          revision: string | null
          revision_id: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_customer_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      production_order_directory: {
        Row: {
          archived_at: string | null
          close_request_pending: boolean | null
          completion_allowed: boolean | null
          computed_priority: number | null
          created_at: string | null
          current_machine_code: string | null
          current_operation_code: string | null
          current_operation_external: boolean | null
          current_operation_name: string | null
          current_operation_status: string | null
          customer_id: string | null
          customer_name: string | null
          customer_number: number | null
          days_to_due: number | null
          due_date: string | null
          due_warning: string | null
          due_warning_days: number | null
          effective_priority: number | null
          good_quantity: number | null
          id: string | null
          machine_ids: string[] | null
          notes: string | null
          operation_count: number | null
          operations_done: number | null
          order_number: string | null
          order_sequence: number | null
          order_year: number | null
          organization_id: string | null
          part_number: string | null
          planned_end: string | null
          planned_seconds: number | null
          planned_start: string | null
          priority: number | null
          product_id: string | null
          product_name: string | null
          progress_percent: number | null
          quantity: number | null
          remaining_seconds: number | null
          revision: string | null
          revision_id: string | null
          slack_days: number | null
          started: boolean | null
          status: string | null
          status_changed_at: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_orders_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_orders_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_orders_organization_id_revision_id_fkey"
            columns: ["organization_id", "revision_id"]
            isOneToOne: false
            referencedRelation: "product_revisions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      production_order_operation_directory: {
        Row: {
          archived_at: string | null
          cycle_time_s: number | null
          description: string | null
          downtime_seconds: number | null
          external_company: string | null
          good_quantity: number | null
          id: string | null
          input_quantity: number | null
          is_cutting: boolean | null
          is_external: boolean | null
          is_inspection: boolean | null
          machine_code: string | null
          machine_cycle_time_unit: string | null
          machine_id: string | null
          machine_name: string | null
          machine_type_id: string | null
          machine_type_mismatch: boolean | null
          machine_type_name: string | null
          notes: string | null
          operation_code: string | null
          operation_name: string | null
          operation_type_id: string | null
          order_id: string | null
          organization_id: string | null
          overlap_count: number | null
          planned_end: string | null
          planned_seconds: number | null
          planned_start: string | null
          run_seconds: number | null
          scrap_quantity: number | null
          sequence: number | null
          setup_time_min: number | null
          source_operation_id: string | null
          status: string | null
          status_changed_at: string | null
          worker_seconds: number | null
          workers: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "production_order_operations_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machine_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_operations_organization_id_machine_id_fkey"
            columns: ["organization_id", "machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_operations_organization_id_operation_type_fkey"
            columns: ["organization_id", "operation_type_id"]
            isOneToOne: false
            referencedRelation: "operation_types"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_operations_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_order_directory"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "production_order_operations_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
    }
    Functions: {
      absences_range: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: Json
      }
      add_order_operation: {
        Args: { p_operation: Json; p_order_id: string }
        Returns: string
      }
      apply_rotations: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: number
      }
      assign_order_operation: {
        Args: {
          p_employee_ids: string[]
          p_machine_id: string
          p_operation_id: string
          p_planned_end: string
          p_planned_start: string
        }
        Returns: Json
      }
      assign_rotation: {
        Args: {
          p_crew_id: string
          p_employee_id: string
          p_end_date: string
          p_org_id: string
          p_rotation_id: string
          p_start_date: string
        }
        Returns: string
      }
      attach_absence_document: {
        Args: {
          p_absence_id: string
          p_name: string
          p_path: string
          p_size: number
          p_type: string
        }
        Returns: undefined
      }
      attendance_board: {
        Args: { p_date: string; p_org_id: string }
        Returns: Json
      }
      attendance_month: {
        Args: {
          p_from: string
          p_org_id: string
          p_sessions_from: string
          p_to: string
        }
        Returns: Json
      }
      attendance_shift_for: {
        Args: { p_at: string; p_employee_id: string }
        Returns: {
          breaks: Json
          scheduled_end: string
          scheduled_start: string
          shift_id: string
          work_date: string
        }[]
      }
      cancel_absence: {
        Args: { p_absence_id: string; p_note?: string }
        Returns: undefined
      }
      cancel_correction: {
        Args: { p_correction_id: string }
        Returns: undefined
      }
      clock_in: {
        Args: { p_idempotency_key: string; p_org_id: string }
        Returns: string
      }
      clock_out: {
        Args: { p_idempotency_key: string; p_org_id: string }
        Returns: string
      }
      close_sick_leave: {
        Args: { p_absence_id: string; p_last_day: string }
        Returns: undefined
      }
      company_change_requests_to_decide: {
        Args: { p_org_id: string }
        Returns: {
          bank_accounts: Json
          changes: Json
          company: Json
          created_at: string
          id: string
          kind: string
          reason: string
          requested_by: string
        }[]
      }
      copy_product: {
        Args: {
          p_name: string
          p_part_number: string
          p_revision: string
          p_source_revision_id: string
        }
        Returns: string
      }
      copy_production_order: {
        Args: { p_order: Json; p_order_id: string }
        Returns: string
      }
      copy_schedule_week: {
        Args: {
          p_employee_ids?: string[]
          p_org_id: string
          p_source_monday: string
          p_target_monday: string
        }
        Returns: number
      }
      create_kiosk_activation: {
        Args: { p_kiosk_id: string; p_name: string; p_org_id: string }
        Returns: {
          code: string
          expires_at: string
          kiosk_id: string
        }[]
      }
      create_product: {
        Args: { p_org_id: string; p_product: Json; p_revision: Json }
        Returns: string
      }
      create_product_revision: {
        Args: {
          p_product_id: string
          p_revision: string
          p_source_revision_id?: string
        }
        Returns: string
      }
      create_production_order: {
        Args: { p_order: Json; p_org_id: string }
        Returns: string
      }
      current_support_session: {
        Args: { p_org_id: string }
        Returns: {
          approved_until: string
          id: string
          requester_name: string
        }[]
      }
      decide_absence: {
        Args: { p_absence_id: string; p_approve: boolean; p_note?: string }
        Returns: undefined
      }
      decide_absence_interruption: {
        Args: { p_absence_id: string; p_approve: boolean; p_note?: string }
        Returns: undefined
      }
      decide_company_change: {
        Args: {
          p_approve: boolean
          p_note: string
          p_org_id: string
          p_request_id: string
        }
        Returns: undefined
      }
      decide_correction: {
        Args: { p_approve: boolean; p_correction_id: string; p_note?: string }
        Returns: undefined
      }
      decide_order_close: {
        Args: { p_approve: boolean; p_note?: string; p_request_id: string }
        Returns: undefined
      }
      decide_support_request: {
        Args: {
          p_approve: boolean
          p_minutes?: number
          p_note?: string
          p_org_id: string
          p_request_id: string
        }
        Returns: undefined
      }
      end_rotation_assignment: {
        Args: { p_assignment_id: string; p_end_date: string }
        Returns: undefined
      }
      end_support: { Args: { p_request_id: string }; Returns: string }
      enter_absence: {
        Args: {
          p_employee_id: string
          p_end: string
          p_idempotency_key: string
          p_kind: string
          p_note: string
          p_org_id: string
          p_reason: string
          p_start: string
        }
        Returns: string
      }
      enter_correction: {
        Args: {
          p_clock_in_at: string
          p_clock_out_at: string
          p_employee_id: string
          p_idempotency_key: string
          p_org_id: string
          p_reason: string
          p_session_id: string
        }
        Returns: string
      }
      finish_cutting: {
        Args: {
          p_idempotency_key: string
          p_order_id: string
          p_quantity: number
        }
        Returns: undefined
      }
      floor_operation: { Args: { p_operation_id: string }; Returns: Json }
      floor_operation_queue: {
        Args: { p_machine_id?: string; p_org_id: string }
        Returns: {
          arrived: boolean
          assigned_by_name: boolean
          description: string
          due_date: string
          due_warning: string
          effective_priority: number
          good_quantity: number
          input_quantity: number
          is_cutting: boolean
          is_inspection: boolean
          machine_code: string
          operation_code: string
          operation_id: string
          operation_name: string
          order_id: string
          order_number: string
          order_status: string
          part_number: string
          planned_seconds: number
          previous_code: string
          previous_status: string
          product_name: string
          quantity: number
          revision: string
          scrap_quantity: number
          sequence: number
          status: string
          unit: string
          working: boolean
        }[]
      }
      floor_operation_work: { Args: { p_operation_id: string }; Returns: Json }
      floor_order: { Args: { p_order_id: string }; Returns: Json }
      get_company: { Args: { p_company_id: string }; Returns: Json }
      get_login_organization: {
        Args: { p_slug: string }
        Returns: {
          name: string
        }[]
      }
      has_permission: {
        Args: { p_org_id: string; p_permission: string }
        Returns: boolean
      }
      import_org_holidays: {
        Args: { p_org_id: string; p_year: number }
        Returns: number
      }
      is_session_active: { Args: never; Returns: boolean }
      issue_badge: { Args: { p_employee_id: string }; Returns: string }
      kiosk_activate: {
        Args: { p_code: string; p_org_slug: string }
        Returns: {
          kiosk_id: string
          kiosk_name: string
          secret: string
        }[]
      }
      kiosk_clock: {
        Args: {
          p_badge: string
          p_employee_id: string
          p_idempotency_key: string
          p_kiosk_id: string
          p_org_slug: string
          p_pin: string
          p_secret: string
        }
        Returns: Json
      }
      kiosk_credentials: {
        Args: { p_org_id: string }
        Returns: {
          badge_token: string
          employee_id: string
          employee_number: number
          has_pin: boolean
          locked_until: string
          name: string
        }[]
      }
      kiosk_session: {
        Args: { p_kiosk_id: string; p_org_slug: string; p_secret: string }
        Returns: Json
      }
      leave_overview: {
        Args: { p_org_id: string; p_year: number }
        Returns: Json
      }
      list_kiosks: {
        Args: { p_org_id: string }
        Returns: {
          activated_at: string
          activation_expires_at: string
          id: string
          last_seen_at: string
          name: string
          status: string
        }[]
      }
      my_attendance: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: Json
      }
      my_company_change_requests: {
        Args: { p_org_id: string }
        Returns: {
          changes: Json
          company_name: string
          created_at: string
          decided_at: string
          decision_note: string
          id: string
          kind: string
          status: string
        }[]
      }
      my_kiosk_pin_set: { Args: { p_org_id: string }; Returns: boolean }
      my_pay_inputs: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: Json
      }
      my_requests: { Args: { p_org_id: string; p_year: number }; Returns: Json }
      my_schedule: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: {
          code: string
          ends_at: string
          name: string
          shift_id: string
          starts_at: string
          work_date: string
        }[]
      }
      order_file_path: { Args: { p_attachment_id: string }; Returns: string }
      order_operation_warnings: {
        Args: { p_operation_id: string }
        Returns: Json
      }
      organization_profile: { Args: { p_org_id: string }; Returns: Json }
      pause_operation_work: {
        Args: { p_notes?: string; p_operation_id: string; p_reason_id: string }
        Returns: undefined
      }
      pending_attendance_alerts: {
        Args: { p_org_id: string }
        Returns: {
          alert_id: string
          clock_in_at: string
          clock_out_at: string
          created_at: string
          employee_id: string
          employee_name: string
          kind: string
          session_id: string
        }[]
      }
      pending_close_requests: {
        Args: { p_org_id: string }
        Returns: {
          good_quantity: number
          order_id: string
          order_number: string
          quantity: number
          reason: string
          request_id: string
          requested_at: string
          requested_by_name: string
          unit: string
        }[]
      }
      pending_requests: { Args: { p_org_id: string }; Returns: Json }
      pending_support_requests: {
        Args: { p_org_id: string }
        Returns: {
          created_at: string
          id: string
          reason: string
          requester_name: string
        }[]
      }
      platform_begin_support: {
        Args: { p_request_id: string }
        Returns: {
          approved_until: string
          organization_id: string
          slug: string
        }[]
      }
      platform_get_settings: { Args: never; Returns: Json }
      platform_organizations: {
        Args: never
        Returns: {
          archived: boolean
          claim_pending: boolean
          company: Json
          created_at: string
          id: string
          member_count: number
          modules: Json
          name: string
          slug: string
        }[]
      }
      platform_request_support: {
        Args: { p_org_id: string; p_reason: string }
        Returns: string
      }
      platform_set_module: {
        Args: {
          p_active_until?: string
          p_enabled: boolean
          p_module: string
          p_org_id: string
        }
        Returns: undefined
      }
      platform_set_trial_days: { Args: { p_days: number }; Returns: undefined }
      platform_support_requests: {
        Args: never
        Returns: {
          approved_until: string
          created_at: string
          decision_note: string
          duration_minutes: number
          id: string
          organization_id: string
          reason: string
          requester_name: string
          status: string
        }[]
      }
      product_history: {
        Args: { p_limit?: number; p_product_id: string }
        Returns: {
          action: string
          actor_id: string
          actor_username: string
          after: Json
          before: Json
          created_at: string
          entity_id: string
          entity_type: string
          id: number
        }[]
      }
      production_day: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: Json
      }
      production_order_close_log: {
        Args: { p_order_id: string }
        Returns: {
          decided_at: string
          decided_by_name: string
          decision_note: string
          good_quantity: number
          id: string
          reason: string
          requested_at: string
          requested_by_name: string
          status: string
        }[]
      }
      production_order_downtime: {
        Args: { p_order_id: string }
        Returns: {
          duration_seconds: number
          employee_name: string
          ended_at: string
          id: string
          machine_code: string
          notes: string
          operation_code: string
          operation_sequence: number
          reason: string
          source: string
          started_at: string
        }[]
      }
      production_order_history: {
        Args: { p_limit?: number; p_order_id: string }
        Returns: {
          action: string
          actor_username: string
          after: Json
          before: Json
          created_at: string
          entity_id: string
          entity_type: string
          id: number
        }[]
      }
      production_order_reports: {
        Args: { p_order_id: string }
        Returns: {
          employee_name: string
          good_quantity: number
          id: string
          machine_code: string
          notes: string
          operation_code: string
          operation_id: string
          operation_sequence: number
          reported_at: string
          scrap_quantity: number
          scrap_reason: string
          username: string
          void_reason: string
          voided_at: string
        }[]
      }
      production_order_status_log: {
        Args: { p_order_id: string }
        Returns: {
          changed_at: string
          from_status: string
          full_name: string
          id: number
          operation_code: string
          operation_id: string
          operation_sequence: number
          reason: string
          to_status: string
          username: string
        }[]
      }
      production_order_tool_changes: {
        Args: { p_order_id: string }
        Returns: {
          changed_at: string
          duration_min: number
          employee_name: string
          id: string
          insert_name: string
          machine_code: string
          notes: string
          operation_code: string
          reason: string
          tool: string
        }[]
      }
      record_downtime: {
        Args: {
          p_idempotency_key: string
          p_minutes: number
          p_notes?: string
          p_operation_id: string
          p_reason_id: string
          p_started_at?: string
        }
        Returns: string
      }
      record_tool_change: {
        Args: {
          p_idempotency_key: string
          p_insert: string
          p_minutes: number
          p_notes: string
          p_operation_id: string
          p_reason_id: string
          p_tool: string
        }
        Returns: string
      }
      register_organization: {
        Args: {
          p_bank_accounts: Json
          p_country: string
          p_fields: Json
          p_slug: string
          p_tax_id: string
          p_timezone: string
        }
        Returns: Json
      }
      registration_attempt: {
        Args: { p_client_hash: string; p_kind: string; p_max: number }
        Returns: boolean
      }
      reorder_product_operations: {
        Args: { p_operation_ids: string[]; p_revision_id: string }
        Returns: undefined
      }
      replace_order_drawings: {
        Args: { p_order_id: string; p_revision_id: string }
        Returns: undefined
      }
      report_operation_quantity: {
        Args: {
          p_finish?: boolean
          p_good: number
          p_idempotency_key: string
          p_notes: string
          p_operation_id: string
          p_scrap: number
          p_scrap_reason_id: string
        }
        Returns: Json
      }
      request_absence: {
        Args: {
          p_end: string
          p_idempotency_key: string
          p_kind: string
          p_note: string
          p_org_id: string
          p_reason: string
          p_start: string
        }
        Returns: string
      }
      request_absence_interruption: {
        Args: { p_absence_id: string; p_last_day: string; p_note: string }
        Returns: undefined
      }
      request_company_change: {
        Args: {
          p_bank_accounts?: Json
          p_changes: Json
          p_company_id: string
          p_org_id: string
          p_reason?: string
        }
        Returns: string
      }
      request_correction: {
        Args: {
          p_clock_in_at: string
          p_clock_out_at: string
          p_idempotency_key: string
          p_org_id: string
          p_reason: string
          p_session_id: string
        }
        Returns: string
      }
      request_order_close: {
        Args: { p_order_id: string; p_reason: string }
        Returns: string
      }
      resolve_attendance_alert: {
        Args: { p_alert_id: string; p_note?: string }
        Returns: undefined
      }
      revoke_kiosk: { Args: { p_kiosk_id: string }; Returns: undefined }
      revoke_user_sessions: { Args: { p_user_id: string }; Returns: undefined }
      save_crew: {
        Args: {
          p_color: string
          p_employee_ids: string[]
          p_id: string
          p_name: string
          p_org_id: string
        }
        Returns: string
      }
      save_customer: {
        Args: {
          p_company_id?: string
          p_customer: Json
          p_customer_id?: string
          p_org_id: string
        }
        Returns: Json
      }
      save_employee: {
        Args: {
          p_department_id?: string
          p_employee_id?: string
          p_employee_number?: number
          p_first_name: string
          p_job_title_id?: string
          p_last_name: string
          p_machine_ids: string[]
          p_org_id: string
          p_skills: Json
          p_status: string
          p_user_id?: string
        }
        Returns: string
      }
      save_leave_data: {
        Args: {
          p_carried_over_days: number
          p_employee_id: string
          p_entitlement_override: number
          p_hired_on: string
          p_prior_service_months: number
          p_year: number
        }
        Returns: undefined
      }
      save_org_holiday: {
        Args: {
          p_archived: boolean
          p_date: string
          p_id: string
          p_name: string
          p_org_id: string
        }
        Returns: string
      }
      save_organization_profile: {
        Args: {
          p_bank_accounts: Json
          p_country: string
          p_fields: Json
          p_org_id: string
          p_tax_id: string
        }
        Returns: string
      }
      save_pay_settings: {
        Args: {
          p_default_hourly_rate: number
          p_holiday_pct: number
          p_night_pct: number
          p_org_id: string
          p_overtime_pct: number
          p_weekend_pct: number
        }
        Returns: undefined
      }
      save_product_operation: {
        Args: {
          p_operation: Json
          p_operation_id: string
          p_revision_id: string
        }
        Returns: string
      }
      save_rotation: {
        Args: {
          p_cycle_days: number
          p_days: Json
          p_id: string
          p_name: string
          p_org_id: string
        }
        Returns: string
      }
      save_shift: {
        Args: {
          p_breaks: Json
          p_code: string
          p_color: string
          p_ends_at: string
          p_id: string
          p_name: string
          p_org_id: string
          p_starts_at: string
        }
        Returns: string
      }
      save_work_calendar: {
        Args: {
          p_employee_id: string
          p_holiday_keys: string[]
          p_weekend_days: number[]
        }
        Returns: undefined
      }
      schedule_range: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: Json
      }
      search_companies: {
        Args: { p_query: string }
        Returns: {
          city: string
          country: string
          id: string
          name: string
          tax_id: string
        }[]
      }
      session_status: {
        Args: never
        Returns: {
          active: boolean
          must_change_password: boolean
          support_ended: boolean
        }[]
      }
      set_crew_archived: {
        Args: { p_archived: boolean; p_crew_id: string }
        Returns: undefined
      }
      set_current_revision: {
        Args: { p_revision_id: string }
        Returns: undefined
      }
      set_employee_pin: {
        Args: { p_employee_id: string; p_pin: string }
        Returns: undefined
      }
      set_holiday_scope: {
        Args: { p_key: string; p_org_id: string; p_scope: string }
        Returns: undefined
      }
      set_hourly_rate: {
        Args: { p_employee_id: string; p_rate: number; p_valid_from: string }
        Returns: undefined
      }
      set_machine_status: {
        Args: { p_machine_id: string; p_status: string }
        Returns: undefined
      }
      set_order_operation_status: {
        Args: { p_operation_id: string; p_status: string }
        Returns: undefined
      }
      set_own_pin: {
        Args: { p_org_id: string; p_pin: string }
        Returns: undefined
      }
      set_product_operation_archived: {
        Args: { p_archived: boolean; p_operation_id: string }
        Returns: undefined
      }
      set_production_order_status: {
        Args: { p_order_id: string; p_reason?: string; p_status: string }
        Returns: undefined
      }
      set_rotation_archived: {
        Args: { p_archived: boolean; p_rotation_id: string }
        Returns: undefined
      }
      set_schedule_entries: {
        Args: { p_entries: Json; p_org_id: string }
        Returns: number
      }
      set_shift_archived: {
        Args: { p_archived: boolean; p_shift_id: string }
        Returns: undefined
      }
      start_operation_work: {
        Args: { p_operation_id: string }
        Returns: undefined
      }
      update_product: {
        Args: { p_product: Json; p_product_id: string; p_revision: Json }
        Returns: string
      }
      void_production_report: {
        Args: { p_reason: string; p_report_id: string }
        Returns: undefined
      }
      write_audit: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_entity_id?: string
          p_entity_type: string
          p_org_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

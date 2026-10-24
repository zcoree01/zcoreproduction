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
      machines: {
        Row: {
          archived_at: string | null
          code: string
          created_at: string
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
      org_modules: {
        Row: {
          created_at: string
          enabled: boolean
          enabled_at: string | null
          module_key: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          module_key: string
          organization_id: string
          updated_at?: string
        }
        Update: {
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
          created_at: string
          id: string
          name: string
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
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
      profiles: {
        Row: {
          archived_at: string | null
          created_at: string
          full_name: string | null
          id: string
          organization_id: string
          updated_at: string
          username: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          organization_id: string
          updated_at?: string
          username: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          organization_id?: string
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
    }
    Functions: {
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
      is_session_active: { Args: never; Returns: boolean }
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
      set_machine_status: {
        Args: { p_machine_id: string; p_status: string }
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

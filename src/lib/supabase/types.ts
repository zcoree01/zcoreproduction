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
      customers: {
        Row: {
          address: string | null
          archived_at: string | null
          city: string | null
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
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          city?: string | null
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
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          city?: string | null
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
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
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
          computed_priority: number | null
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          customer_number: number | null
          days_to_due: number | null
          due_date: string | null
          due_warning: string | null
          due_warning_days: number | null
          effective_priority: number | null
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
          external_company: string | null
          id: string | null
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
          sequence: number | null
          setup_time_min: number | null
          source_operation_id: string | null
          status: string | null
          status_changed_at: string | null
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
      add_order_operation: {
        Args: { p_operation: Json; p_order_id: string }
        Returns: string
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
      floor_operation: { Args: { p_operation_id: string }; Returns: Json }
      floor_operation_queue: {
        Args: { p_machine_id?: string; p_org_id: string }
        Returns: {
          assigned_by_name: boolean
          description: string
          due_date: string
          due_warning: string
          effective_priority: number
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
          sequence: number
          status: string
          unit: string
        }[]
      }
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
      order_file_path: { Args: { p_attachment_id: string }; Returns: string }
      order_operation_warnings: {
        Args: { p_operation_id: string }
        Returns: Json
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
      reorder_product_operations: {
        Args: { p_operation_ids: string[]; p_revision_id: string }
        Returns: undefined
      }
      replace_order_drawings: {
        Args: { p_order_id: string; p_revision_id: string }
        Returns: undefined
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
      save_product_operation: {
        Args: {
          p_operation: Json
          p_operation_id: string
          p_revision_id: string
        }
        Returns: string
      }
      set_current_revision: {
        Args: { p_revision_id: string }
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
      set_product_operation_archived: {
        Args: { p_archived: boolean; p_operation_id: string }
        Returns: undefined
      }
      set_production_order_status: {
        Args: { p_order_id: string; p_reason?: string; p_status: string }
        Returns: undefined
      }
      update_product: {
        Args: { p_product: Json; p_product_id: string; p_revision: Json }
        Returns: string
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

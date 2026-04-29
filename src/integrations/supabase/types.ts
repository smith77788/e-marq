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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ab_tests: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          metric: string
          name: string
          results: Json
          started_at: string
          status: string
          tenant_id: string
          test_key: string
          updated_at: string
          variants: Json
          winner_variant: string | null
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          metric?: string
          name: string
          results?: Json
          started_at?: string
          status?: string
          tenant_id: string
          test_key: string
          updated_at?: string
          variants?: Json
          winner_variant?: string | null
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          metric?: string
          name?: string
          results?: Json
          started_at?: string
          status?: string
          tenant_id?: string
          test_key?: string
          updated_at?: string
          variants?: Json
          winner_variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ab_tests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ab_tests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acos_agent_runs: {
        Row: {
          agent_id: string
          error: string | null
          finished_at: string | null
          id: string
          insights_created: number
          metadata: Json
          started_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          agent_id: string
          error?: string | null
          finished_at?: string | null
          id?: string
          insights_created?: number
          metadata?: Json
          started_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          agent_id?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          insights_created?: number
          metadata?: Json
          started_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acos_agent_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "acos_agent_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      action_outcomes: {
        Row: {
          action_id: string | null
          action_type: string
          actual: Json
          agent_id: string
          attributed_revenue_cents: number
          baseline: Json
          decision_id: string | null
          delta: Json
          id: string
          measured_at: string
          measurement_window: string
          notes: string | null
          success: boolean | null
          tenant_id: string
        }
        Insert: {
          action_id?: string | null
          action_type: string
          actual?: Json
          agent_id: string
          attributed_revenue_cents?: number
          baseline?: Json
          decision_id?: string | null
          delta?: Json
          id?: string
          measured_at?: string
          measurement_window?: string
          notes?: string | null
          success?: boolean | null
          tenant_id: string
        }
        Update: {
          action_id?: string | null
          action_type?: string
          actual?: Json
          agent_id?: string
          attributed_revenue_cents?: number
          baseline?: Json
          decision_id?: string | null
          delta?: Json
          id?: string
          measured_at?: string
          measurement_window?: string
          notes?: string | null
          success?: boolean | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_outcomes_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decision_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_capabilities: {
        Row: {
          description: string
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          description: string
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          description?: string
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      admin_permissions: {
        Row: {
          capability: string
          granted_at: string
          granted_by: string | null
          id: string
          user_id: string
        }
        Insert: {
          capability: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          user_id: string
        }
        Update: {
          capability?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_permissions_capability_fkey"
            columns: ["capability"]
            isOneToOne: false
            referencedRelation: "admin_capabilities"
            referencedColumns: ["key"]
          },
        ]
      }
      agent_conflicts: {
        Row: {
          conflict_type: string
          conflicting_action_ids: string[]
          created_at: string
          id: string
          reason: string | null
          resolution: string
          resolved_at: string | null
          tenant_id: string
          winning_action_id: string | null
        }
        Insert: {
          conflict_type: string
          conflicting_action_ids?: string[]
          created_at?: string
          id?: string
          reason?: string | null
          resolution?: string
          resolved_at?: string | null
          tenant_id: string
          winning_action_id?: string | null
        }
        Update: {
          conflict_type?: string
          conflicting_action_ids?: string[]
          created_at?: string
          id?: string
          reason?: string | null
          resolution?: string
          resolved_at?: string | null
          tenant_id?: string
          winning_action_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_conflicts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "agent_conflicts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_health: {
        Row: {
          agent_id: string
          created_at: string
          health_score: number
          id: string
          insights_approved: number
          insights_created: number
          insights_dismissed: number
          measured_on: string
          measured_revenue_lift_cents: number
          runs_failed: number
          runs_total: number
          tenant_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          health_score?: number
          id?: string
          insights_approved?: number
          insights_created?: number
          insights_dismissed?: number
          measured_on?: string
          measured_revenue_lift_cents?: number
          runs_failed?: number
          runs_total?: number
          tenant_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          health_score?: number
          id?: string
          insights_approved?: number
          insights_created?: number
          insights_dismissed?: number
          measured_on?: string
          measured_revenue_lift_cents?: number
          runs_failed?: number
          runs_total?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_health_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "agent_health_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_permissions: {
        Row: {
          agent_id: string
          auto_apply_max_risk: Database["public"]["Enums"]["agent_risk_level"]
          created_at: string
          geo_targets: Json | null
          id: string
          last_changed_by: string | null
          mode: Database["public"]["Enums"]["agent_mode"]
          notify_on_apply: boolean
          tenant_id: string
          updated_at: string
          weekly_run_limit: number
        }
        Insert: {
          agent_id: string
          auto_apply_max_risk?: Database["public"]["Enums"]["agent_risk_level"]
          created_at?: string
          geo_targets?: Json | null
          id?: string
          last_changed_by?: string | null
          mode?: Database["public"]["Enums"]["agent_mode"]
          notify_on_apply?: boolean
          tenant_id: string
          updated_at?: string
          weekly_run_limit?: number
        }
        Update: {
          agent_id?: string
          auto_apply_max_risk?: Database["public"]["Enums"]["agent_risk_level"]
          created_at?: string
          geo_targets?: Json | null
          id?: string
          last_changed_by?: string | null
          mode?: Database["public"]["Enums"]["agent_mode"]
          notify_on_apply?: boolean
          tenant_id?: string
          updated_at?: string
          weekly_run_limit?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "agent_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_actions: {
        Row: {
          action_type: string
          actual_result: Json
          agent_id: string
          applied_at: string | null
          created_at: string
          dispatch_request_id: number | null
          dispatched_at: string | null
          expected_impact: string | null
          id: string
          measured_at: string | null
          parameters: Json
          reverted_at: string | null
          reverted_reason: string | null
          source_insight_id: string | null
          status: string
          target_entity: string | null
          target_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          action_type: string
          actual_result?: Json
          agent_id: string
          applied_at?: string | null
          created_at?: string
          dispatch_request_id?: number | null
          dispatched_at?: string | null
          expected_impact?: string | null
          id?: string
          measured_at?: string | null
          parameters?: Json
          reverted_at?: string | null
          reverted_reason?: string | null
          source_insight_id?: string | null
          status?: string
          target_entity?: string | null
          target_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          actual_result?: Json
          agent_id?: string
          applied_at?: string | null
          created_at?: string
          dispatch_request_id?: number | null
          dispatched_at?: string | null
          expected_impact?: string | null
          id?: string
          measured_at?: string | null
          parameters?: Json
          reverted_at?: string | null
          reverted_reason?: string | null
          source_insight_id?: string | null
          status?: string
          target_entity?: string | null
          target_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_actions_source_insight_id_fkey"
            columns: ["source_insight_id"]
            isOneToOne: false
            referencedRelation: "ai_insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ai_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_insights: {
        Row: {
          affected_layer: string | null
          confidence: number
          created_at: string
          dedup_bucket: number | null
          description: string
          expected_impact: string | null
          id: string
          insight_type: string
          metrics: Json
          risk_level: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          affected_layer?: string | null
          confidence?: number
          created_at?: string
          dedup_bucket?: number | null
          description?: string
          expected_impact?: string | null
          id?: string
          insight_type: string
          metrics?: Json
          risk_level?: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          affected_layer?: string | null
          confidence?: number
          created_at?: string
          dedup_bucket?: number | null
          description?: string
          expected_impact?: string | null
          id?: string
          insight_type?: string
          metrics?: Json
          risk_level?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ai_insights_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_memory: {
        Row: {
          agent: string
          avg_impact: number
          category: string
          confidence: number
          created_at: string
          evidence: Json
          failure_count: number
          id: string
          is_active: boolean
          last_observed_at: string
          learned_rule: string
          pattern_key: string
          success_count: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          agent: string
          avg_impact?: number
          category: string
          confidence?: number
          created_at?: string
          evidence?: Json
          failure_count?: number
          id?: string
          is_active?: boolean
          last_observed_at?: string
          learned_rule?: string
          pattern_key: string
          success_count?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          agent?: string
          avg_impact?: number
          category?: string
          confidence?: number
          created_at?: string
          evidence?: Json
          failure_count?: number
          id?: string
          is_active?: boolean
          last_observed_at?: string
          learned_rule?: string
          pattern_key?: string
          success_count?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_memory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ai_memory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      anon_event_rate_limit: {
        Row: {
          bucket_minute: string
          count: number
          id: number
          session_id: string
          tenant_id: string
        }
        Insert: {
          bucket_minute: string
          count?: number
          id?: number
          session_id: string
          tenant_id: string
        }
        Update: {
          bucket_minute?: string
          count?: number
          id?: number
          session_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      auto_approval_policy: {
        Row: {
          action_type: string
          created_at: string
          enabled: boolean
          max_age_hours: number
          min_success_history: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          action_type: string
          created_at?: string
          enabled?: boolean
          max_age_hours?: number
          min_success_history?: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          action_type?: string
          created_at?: string
          enabled?: boolean
          max_age_hours?: number
          min_success_history?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      balance_ledger: {
        Row: {
          actor_user_id: string | null
          amount: number
          balance_after: number
          created_at: string
          direction: string
          id: string
          kind: string
          metadata: Json
          reason: string
          reference_id: string | null
          reference_kind: string | null
          tenant_id: string
        }
        Insert: {
          actor_user_id?: string | null
          amount: number
          balance_after: number
          created_at?: string
          direction: string
          id?: string
          kind: string
          metadata?: Json
          reason: string
          reference_id?: string | null
          reference_kind?: string | null
          tenant_id: string
        }
        Update: {
          actor_user_id?: string | null
          amount?: number
          balance_after?: number
          created_at?: string
          direction?: string
          id?: string
          kind?: string
          metadata?: Json
          reason?: string
          reference_id?: string | null
          reference_kind?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "balance_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "balance_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bootstrap_facts: {
        Row: {
          confidence: number
          created_at: string
          evidence: Json
          expires_at: string | null
          fact_key: string
          fact_kind: string
          id: string
          source: string
          tenant_id: string
          updated_at: string
          value: Json
        }
        Insert: {
          confidence?: number
          created_at?: string
          evidence?: Json
          expires_at?: string | null
          fact_key?: string
          fact_kind: string
          id?: string
          source?: string
          tenant_id: string
          updated_at?: string
          value?: Json
        }
        Update: {
          confidence?: number
          created_at?: string
          evidence?: Json
          expires_at?: string | null
          fact_key?: string
          fact_kind?: string
          id?: string
          source?: string
          tenant_id?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "bootstrap_facts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bootstrap_facts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_recovery_attempts: {
        Row: {
          abandoned_at: string
          attempt_number: number
          cart_items: Json
          cart_value_cents: number
          channel: string
          created_at: string
          customer_id: string | null
          id: string
          outbound_message_id: string | null
          recovered: boolean
          recovered_at: string | null
          recovered_revenue_cents: number | null
          session_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          abandoned_at?: string
          attempt_number?: number
          cart_items?: Json
          cart_value_cents?: number
          channel?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          outbound_message_id?: string | null
          recovered?: boolean
          recovered_at?: string | null
          recovered_revenue_cents?: number | null
          session_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          abandoned_at?: string
          attempt_number?: number
          cart_items?: Json
          cart_value_cents?: number
          channel?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          outbound_message_id?: string | null
          recovered?: boolean
          recovered_at?: string | null
          recovered_revenue_cents?: number | null
          session_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_recovery_attempts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_recovery_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "cart_recovery_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_attribution: {
        Row: {
          attributed_revenue: Json
          attribution_model: string
          created_at: string
          customer_id: string | null
          first_touch_channel: string | null
          id: string
          last_touch_channel: string | null
          order_id: string | null
          tenant_id: string
          touchpoints: Json
        }
        Insert: {
          attributed_revenue?: Json
          attribution_model?: string
          created_at?: string
          customer_id?: string | null
          first_touch_channel?: string | null
          id?: string
          last_touch_channel?: string | null
          order_id?: string | null
          tenant_id: string
          touchpoints?: Json
        }
        Update: {
          attributed_revenue?: Json
          attribution_model?: string
          created_at?: string
          customer_id?: string | null
          first_touch_channel?: string | null
          id?: string
          last_touch_channel?: string | null
          order_id?: string | null
          tenant_id?: string
          touchpoints?: Json
        }
        Relationships: [
          {
            foreignKeyName: "channel_attribution_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_attribution_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_attribution_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "channel_attribution_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_products: {
        Row: {
          collection_id: string
          position: number
          product_id: string
          tenant_id: string
        }
        Insert: {
          collection_id: string
          position?: number
          product_id: string
          tenant_id: string
        }
        Update: {
          collection_id?: string
          position?: number
          product_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_products_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "collection_products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string
          description: string | null
          handle: string
          id: string
          image_url: string | null
          is_active: boolean
          is_smart: boolean
          name: string
          rules: Json | null
          seo_description: string | null
          seo_title: string | null
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          handle: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_smart?: boolean
          name: string
          rules?: Json | null
          seo_description?: string | null
          seo_title?: string | null
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          handle?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_smart?: boolean
          name?: string
          rules?: Json | null
          seo_description?: string | null
          seo_title?: string | null
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "collections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      content_pages: {
        Row: {
          agent: string | null
          agent_generated: boolean
          body_md: string | null
          content_type: string
          created_at: string
          id: string
          is_published: boolean
          metadata: Json
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          agent?: string | null
          agent_generated?: boolean
          body_md?: string | null
          content_type?: string
          created_at?: string
          id?: string
          is_published?: boolean
          metadata?: Json
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          agent?: string | null
          agent_generated?: boolean
          body_md?: string | null
          content_type?: string
          created_at?: string
          id?: string
          is_published?: boolean
          metadata?: Json
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_pages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "content_pages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      content_performance: {
        Row: {
          avg_time_on_page_seconds: number
          bounce_rate: number
          conversions: number
          created_at: string
          id: string
          measured_on: string
          page_id: string | null
          search_clicks: number
          search_impressions: number
          search_position: number | null
          tenant_id: string
          unique_visitors: number
          url: string
          views: number
        }
        Insert: {
          avg_time_on_page_seconds?: number
          bounce_rate?: number
          conversions?: number
          created_at?: string
          id?: string
          measured_on?: string
          page_id?: string | null
          search_clicks?: number
          search_impressions?: number
          search_position?: number | null
          tenant_id: string
          unique_visitors?: number
          url: string
          views?: number
        }
        Update: {
          avg_time_on_page_seconds?: number
          bounce_rate?: number
          conversions?: number
          created_at?: string
          id?: string
          measured_on?: string
          page_id?: string | null
          search_clicks?: number
          search_impressions?: number
          search_position?: number | null
          tenant_id?: string
          unique_visitors?: number
          url?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_performance_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "content_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_performance_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "content_performance_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          body: string
          channel: string
          created_at: string
          customer_id: string | null
          direction: string
          external_thread_id: string | null
          id: string
          intent: string | null
          metadata: Json
          tenant_id: string
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          customer_id?: string | null
          direction: string
          external_thread_id?: string | null
          id?: string
          intent?: string | null
          metadata?: Json
          tenant_id: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          customer_id?: string | null
          direction?: string
          external_thread_id?: string | null
          id?: string
          intent?: string | null
          metadata?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_cohorts: {
        Row: {
          cohort_month: string
          computed_at: string
          created_at: string
          customer_count: number
          id: string
          retention_curve: Json
          revenue_curve: Json
          tenant_id: string
        }
        Insert: {
          cohort_month: string
          computed_at?: string
          created_at?: string
          customer_count?: number
          id?: string
          retention_curve?: Json
          revenue_curve?: Json
          tenant_id: string
        }
        Update: {
          cohort_month?: string
          computed_at?: string
          created_at?: string
          customer_count?: number
          id?: string
          retention_curve?: Json
          revenue_curve?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_cohorts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "customer_cohorts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_ltv_scores: {
        Row: {
          cac_cents: number | null
          churn_probability: number
          churn_reason: string | null
          computed_at: string
          created_at: string
          customer_id: string
          id: string
          ltv_cac_ratio: number | null
          predicted_ltv_cents: number
          predicted_orders_12m: number
          segment: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cac_cents?: number | null
          churn_probability?: number
          churn_reason?: string | null
          computed_at?: string
          created_at?: string
          customer_id: string
          id?: string
          ltv_cac_ratio?: number | null
          predicted_ltv_cents?: number
          predicted_orders_12m?: number
          segment?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cac_cents?: number | null
          churn_probability?: number
          churn_reason?: string | null
          computed_at?: string
          created_at?: string
          customer_id?: string
          id?: string
          ltv_cac_ratio?: number | null
          predicted_ltv_cents?: number
          predicted_orders_12m?: number
          segment?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_ltv_scores_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ltv_scores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "customer_ltv_scores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_metrics_30d: {
        Row: {
          avg_order_cents: number
          churn_risk: number
          computed_at: string
          customer_id: string
          days_since_last: number | null
          last_order_at: string | null
          lifecycle_stage: string | null
          orders_30d: number
          revenue_30d_cents: number
          tenant_id: string
          window_end: string
          window_start: string
        }
        Insert: {
          avg_order_cents?: number
          churn_risk?: number
          computed_at?: string
          customer_id: string
          days_since_last?: number | null
          last_order_at?: string | null
          lifecycle_stage?: string | null
          orders_30d?: number
          revenue_30d_cents?: number
          tenant_id: string
          window_end: string
          window_start: string
        }
        Update: {
          avg_order_cents?: number
          churn_risk?: number
          computed_at?: string
          customer_id?: string
          days_since_last?: number | null
          last_order_at?: string | null
          lifecycle_stage?: string | null
          orders_30d?: number
          revenue_30d_cents?: number
          tenant_id?: string
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      customer_segments: {
        Row: {
          avg_ltv_cents: number
          created_at: string
          customer_count: number
          description: string | null
          id: string
          is_auto_generated: boolean
          name: string
          rules: Json
          segment_key: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          avg_ltv_cents?: number
          created_at?: string
          customer_count?: number
          description?: string | null
          id?: string
          is_auto_generated?: boolean
          name: string
          rules?: Json
          segment_key: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          avg_ltv_cents?: number
          created_at?: string
          customer_count?: number
          description?: string | null
          id?: string
          is_auto_generated?: boolean
          name?: string
          rules?: Json
          segment_key?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_segments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "customer_segments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          avg_cycle_days: number | null
          avg_order_cents: number
          consent_marketing: boolean
          created_at: string
          email: string | null
          first_order_at: string | null
          id: string
          last_contacted_at: string | null
          last_order_at: string | null
          lifecycle_stage: string
          metadata: Json
          name: string | null
          predicted_next_order_at: string | null
          telegram_chat_id: string | null
          telegram_username: string | null
          tenant_id: string
          total_orders: number
          total_spent_cents: number
          unsubscribe_token: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avg_cycle_days?: number | null
          avg_order_cents?: number
          consent_marketing?: boolean
          created_at?: string
          email?: string | null
          first_order_at?: string | null
          id?: string
          last_contacted_at?: string | null
          last_order_at?: string | null
          lifecycle_stage?: string
          metadata?: Json
          name?: string | null
          predicted_next_order_at?: string | null
          telegram_chat_id?: string | null
          telegram_username?: string | null
          tenant_id: string
          total_orders?: number
          total_spent_cents?: number
          unsubscribe_token?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avg_cycle_days?: number | null
          avg_order_cents?: number
          consent_marketing?: boolean
          created_at?: string
          email?: string | null
          first_order_at?: string | null
          id?: string
          last_contacted_at?: string | null
          last_order_at?: string | null
          lifecycle_stage?: string
          metadata?: Json
          name?: string | null
          predicted_next_order_at?: string | null
          telegram_chat_id?: string | null
          telegram_username?: string | null
          tenant_id?: string
          total_orders?: number
          total_spent_cents?: number
          unsubscribe_token?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_digests: {
        Row: {
          created_at: string
          delivered_at: string | null
          delivered_channels: string[] | null
          digest_date: string
          highlights: Json
          id: string
          metrics: Json
          recommended_actions: Json
          summary: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          delivered_channels?: string[] | null
          digest_date: string
          highlights?: Json
          id?: string
          metrics?: Json
          recommended_actions?: Json
          summary: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          delivered_channels?: string[] | null
          digest_date?: string
          highlights?: Json
          id?: string
          metrics?: Json
          recommended_actions?: Json
          summary?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_digests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "daily_digests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_policies: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          policy_key: string
          reason: string | null
          tenant_id: string
          total_revenue_cents: number
          trial_count: number
          updated_at: string
          value: Json
          win_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          policy_key: string
          reason?: string | null
          tenant_id: string
          total_revenue_cents?: number
          trial_count?: number
          updated_at?: string
          value: Json
          win_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          policy_key?: string
          reason?: string | null
          tenant_id?: string
          total_revenue_cents?: number
          trial_count?: number
          updated_at?: string
          value?: Json
          win_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "decision_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "decision_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_queue: {
        Row: {
          action_type: string
          agent_id: string
          approved_at: string | null
          approved_by: string | null
          approved_by_auto: boolean
          batch_id: string | null
          confidence: number
          created_at: string
          executed_at: string | null
          executor_action_id: string | null
          expected_impact: Json
          expires_at: string
          id: string
          insight_id: string | null
          payload: Json
          rationale: string | null
          rejected_reason: string | null
          requires_approval: boolean
          status: Database["public"]["Enums"]["decision_status"]
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          action_type: string
          agent_id: string
          approved_at?: string | null
          approved_by?: string | null
          approved_by_auto?: boolean
          batch_id?: string | null
          confidence?: number
          created_at?: string
          executed_at?: string | null
          executor_action_id?: string | null
          expected_impact?: Json
          expires_at?: string
          id?: string
          insight_id?: string | null
          payload?: Json
          rationale?: string | null
          rejected_reason?: string | null
          requires_approval?: boolean
          status?: Database["public"]["Enums"]["decision_status"]
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          agent_id?: string
          approved_at?: string | null
          approved_by?: string | null
          approved_by_auto?: boolean
          batch_id?: string | null
          confidence?: number
          created_at?: string
          executed_at?: string | null
          executor_action_id?: string | null
          expected_impact?: Json
          expires_at?: string
          id?: string
          insight_id?: string | null
          payload?: Json
          rationale?: string | null
          rejected_reason?: string | null
          requires_approval?: boolean
          status?: Database["public"]["Enums"]["decision_status"]
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_queue_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "ai_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      dntrade_health_log: {
        Row: {
          blockers: Json
          checked_at: string
          http_status: number
          id: string
          integration_id: string | null
          last_sync_age_seconds: number | null
          last_sync_status: string | null
          ready: boolean
          status: string
          tenant_id: string
          warnings: Json
        }
        Insert: {
          blockers?: Json
          checked_at?: string
          http_status: number
          id?: string
          integration_id?: string | null
          last_sync_age_seconds?: number | null
          last_sync_status?: string | null
          ready?: boolean
          status: string
          tenant_id: string
          warnings?: Json
        }
        Update: {
          blockers?: Json
          checked_at?: string
          http_status?: number
          id?: string
          integration_id?: string | null
          last_sync_age_seconds?: number | null
          last_sync_status?: string | null
          ready?: boolean
          status?: string
          tenant_id?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "dntrade_health_log_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "tenant_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dntrade_health_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "dntrade_health_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dntrade_sync_errors: {
        Row: {
          external_id: string | null
          id: string
          integration_id: string | null
          kind: string
          message: string
          occurred_at: string
          raw: Json
          tenant_id: string
        }
        Insert: {
          external_id?: string | null
          id?: string
          integration_id?: string | null
          kind: string
          message: string
          occurred_at?: string
          raw?: Json
          tenant_id: string
        }
        Update: {
          external_id?: string | null
          id?: string
          integration_id?: string | null
          kind?: string
          message?: string
          occurred_at?: string
          raw?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dntrade_sync_errors_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "tenant_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dntrade_sync_errors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "dntrade_sync_errors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaign_recipients: {
        Row: {
          campaign_id: string
          created_at: string
          customer_id: string | null
          error: string | null
          id: string
          resend_message_id: string | null
          sent_at: string | null
          status: string
          tenant_id: string
          to_email: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          resend_message_id?: string | null
          sent_at?: string | null
          status?: string
          tenant_id: string
          to_email: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          resend_message_id?: string | null
          sent_at?: string | null
          status?: string
          tenant_id?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "email_campaign_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          clicks_count: number
          created_at: string
          id: string
          metadata: Json
          name: string
          opens_count: number
          recipients_count: number
          scheduled_at: string | null
          segment: string | null
          sent_at: string | null
          status: string
          subject: string
          template: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          clicks_count?: number
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          opens_count?: number
          recipients_count?: number
          scheduled_at?: string | null
          segment?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          template: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          clicks_count?: number
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          opens_count?: number
          recipients_count?: number
          scheduled_at?: string | null
          segment?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          template?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "email_campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          resend_message_id: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          resend_message_id: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          resend_message_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "email_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sends: {
        Row: {
          bounced_at: string | null
          campaign_id: string | null
          clicked_at: string | null
          complained_at: string | null
          created_at: string
          delivered_at: string | null
          error: string | null
          id: string
          metadata: Json
          opened_at: string | null
          order_id: string | null
          resend_message_id: string | null
          status: string
          subject: string | null
          template: string
          tenant_id: string
          to_email: string
          unsubscribed_at: string | null
        }
        Insert: {
          bounced_at?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          complained_at?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          metadata?: Json
          opened_at?: string | null
          order_id?: string | null
          resend_message_id?: string | null
          status?: string
          subject?: string | null
          template: string
          tenant_id: string
          to_email: string
          unsubscribed_at?: string | null
        }
        Update: {
          bounced_at?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          complained_at?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          metadata?: Json
          opened_at?: string | null
          order_id?: string | null
          resend_message_id?: string | null
          status?: string
          subject?: string | null
          template?: string
          tenant_id?: string
          to_email?: string
          unsubscribed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "email_sends_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json
          reason: string
          source_event_id: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json
          reason: string
          source_event_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json
          reason?: string
          source_event_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "email_suppressions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          id: string
          order_id: string | null
          payload: Json
          product_id: string | null
          session_id: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["event_type"]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id?: string | null
          payload?: Json
          product_id?: string | null
          session_id?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["event_type"]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string | null
          payload?: Json
          product_id?: string | null
          session_id?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["event_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_metrics_14d: {
        Row: {
          add_to_cart: number
          checkout: number
          computed_at: string
          day: string
          paid_orders: number
          product_views: number
          revenue_cents: number
          tenant_id: string
          visits: number
        }
        Insert: {
          add_to_cart?: number
          checkout?: number
          computed_at?: string
          day: string
          paid_orders?: number
          product_views?: number
          revenue_cents?: number
          tenant_id: string
          visits?: number
        }
        Update: {
          add_to_cart?: number
          checkout?: number
          computed_at?: string
          day?: string
          paid_orders?: number
          product_views?: number
          revenue_cents?: number
          tenant_id?: string
          visits?: number
        }
        Relationships: []
      }
      import_field_mappings: {
        Row: {
          created_at: string
          entity_kind: string
          id: string
          integration_id: string | null
          is_default: boolean
          mapping: Json
          source_provider: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_kind: string
          id?: string
          integration_id?: string | null
          is_default?: boolean
          mapping?: Json
          source_provider: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_kind?: string
          id?: string
          integration_id?: string | null
          is_default?: boolean
          mapping?: Json
          source_provider?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_field_mappings_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "tenant_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_field_mappings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "import_field_mappings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          entity_kind: string
          error_summary: Json
          finished_at: string | null
          id: string
          integration_id: string | null
          metadata: Json
          rows_failed: number
          rows_imported: number
          rows_skipped: number
          rows_total: number
          source_kind: string
          source_provider: string
          started_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entity_kind: string
          error_summary?: Json
          finished_at?: string | null
          id?: string
          integration_id?: string | null
          metadata?: Json
          rows_failed?: number
          rows_imported?: number
          rows_skipped?: number
          rows_total?: number
          source_kind?: string
          source_provider: string
          started_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entity_kind?: string
          error_summary?: Json
          finished_at?: string | null
          id?: string
          integration_id?: string | null
          metadata?: Json
          rows_failed?: number
          rows_imported?: number
          rows_skipped?: number
          rows_total?: number
          source_kind?: string
          source_provider?: string
          started_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "tenant_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "import_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_rate_limits: {
        Row: {
          bucket_minute: string
          created_at: string
          id: string
          provider: string
          request_count: number
          tenant_id: string
        }
        Insert: {
          bucket_minute: string
          created_at?: string
          id?: string
          provider: string
          request_count?: number
          tenant_id: string
        }
        Update: {
          bucket_minute?: string
          created_at?: string
          id?: string
          provider?: string
          request_count?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_rate_limits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "integration_rate_limits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_forecasts: {
        Row: {
          computed_at: string
          confidence: number
          created_at: string
          forecast_for_date: string
          id: string
          predicted_demand: number
          predicted_stockout_at: string | null
          product_id: string
          recommended_reorder_qty: number
          tenant_id: string
        }
        Insert: {
          computed_at?: string
          confidence?: number
          created_at?: string
          forecast_for_date: string
          id?: string
          predicted_demand?: number
          predicted_stockout_at?: string | null
          product_id: string
          recommended_reorder_qty?: number
          tenant_id: string
        }
        Update: {
          computed_at?: string
          confidence?: number
          created_at?: string
          forecast_for_date?: string
          id?: string
          predicted_demand?: number
          predicted_stockout_at?: string | null
          product_id?: string
          recommended_reorder_qty?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_forecasts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_forecasts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "inventory_forecasts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_magnets: {
        Row: {
          body_md: string
          created_at: string
          cta_url: string
          id: string
          is_published: boolean
          keywords: string[]
          meta_description: string | null
          signups_attributed: number
          slug: string
          title: string
          topic: string | null
          updated_at: string
          views_count: number
        }
        Insert: {
          body_md: string
          created_at?: string
          cta_url?: string
          id?: string
          is_published?: boolean
          keywords?: string[]
          meta_description?: string | null
          signups_attributed?: number
          slug: string
          title: string
          topic?: string | null
          updated_at?: string
          views_count?: number
        }
        Update: {
          body_md?: string
          created_at?: string
          cta_url?: string
          id?: string
          is_published?: boolean
          keywords?: string[]
          meta_description?: string | null
          signups_attributed?: number
          slug?: string
          title?: string
          topic?: string | null
          updated_at?: string
          views_count?: number
        }
        Relationships: []
      }
      lead_outreach: {
        Row: {
          channel: string
          created_at: string
          id: string
          intent: string
          payload: Json
          prospect_id: string
          reply_at: string | null
          response: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          channel: string
          created_at?: string
          id?: string
          intent: string
          payload?: Json
          prospect_id: string
          reply_at?: string | null
          response?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          intent?: string
          payload?: Json
          prospect_id?: string
          reply_at?: string | null
          response?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_outreach_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "lead_prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_prospects: {
        Row: {
          converted_tenant_id: string | null
          country: string | null
          created_at: string
          email: string | null
          estimated_size: string | null
          fit_score: number
          id: string
          instagram_handle: string | null
          last_contacted_at: string | null
          name: string
          niche: string | null
          notes: string | null
          rejected_reason: string | null
          signals: Json
          source: string
          source_query: string | null
          status: string
          telegram_handle: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          converted_tenant_id?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          estimated_size?: string | null
          fit_score?: number
          id?: string
          instagram_handle?: string | null
          last_contacted_at?: string | null
          name: string
          niche?: string | null
          notes?: string | null
          rejected_reason?: string | null
          signals?: Json
          source: string
          source_query?: string | null
          status?: string
          telegram_handle?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          converted_tenant_id?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          estimated_size?: string | null
          fit_score?: number
          id?: string
          instagram_handle?: string | null
          last_contacted_at?: string | null
          name?: string
          niche?: string | null
          notes?: string | null
          rejected_reason?: string | null
          signals?: Json
          source?: string
          source_query?: string | null
          status?: string
          telegram_handle?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_prospects_converted_tenant_id_fkey"
            columns: ["converted_tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "lead_prospects_converted_tenant_id_fkey"
            columns: ["converted_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_accounts: {
        Row: {
          balance_points: number
          created_at: string
          customer_email: string
          id: string
          lifetime_points: number
          tenant_id: string
          tier: string
          updated_at: string
        }
        Insert: {
          balance_points?: number
          created_at?: string
          customer_email: string
          id?: string
          lifetime_points?: number
          tenant_id: string
          tier?: string
          updated_at?: string
        }
        Update: {
          balance_points?: number
          created_at?: string
          customer_email?: string
          id?: string
          lifetime_points?: number
          tenant_id?: string
          tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "loyalty_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_programs: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          min_redeem_points: number
          name: string
          points_per_100_uah: number
          tenant_id: string
          tiers: Json
          uah_per_point: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          min_redeem_points?: number
          name?: string
          points_per_100_uah?: number
          tenant_id: string
          tiers?: Json
          uah_per_point?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          min_redeem_points?: number
          name?: string
          points_per_100_uah?: number
          tenant_id?: string
          tiers?: Json
          uah_per_point?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_programs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "loyalty_programs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          account_id: string
          created_at: string
          description: string | null
          id: string
          order_id: string | null
          points: number
          tenant_id: string
          type: string
        }
        Insert: {
          account_id: string
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          points: number
          tenant_id: string
          type: string
        }
        Update: {
          account_id?: string
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          points?: number
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "loyalty_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "loyalty_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_fraud_signals: {
        Row: {
          created_at: string
          flagged: boolean
          id: string
          order_id: string
          reviewed: boolean
          reviewed_at: string | null
          reviewer_decision: string | null
          risk_score: number
          signals: Json
          tenant_id: string
        }
        Insert: {
          created_at?: string
          flagged?: boolean
          id?: string
          order_id: string
          reviewed?: boolean
          reviewed_at?: string | null
          reviewer_decision?: string | null
          risk_score?: number
          signals?: Json
          tenant_id: string
        }
        Update: {
          created_at?: string
          flagged?: boolean
          id?: string
          order_id?: string
          reviewed?: boolean
          reviewed_at?: string | null
          reviewer_decision?: string | null
          risk_score?: number
          signals?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_fraud_signals_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_fraud_signals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "order_fraud_signals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          tenant_id: string
          unit_price_cents: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          quantity: number
          tenant_id: string
          unit_price_cents: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          tenant_id?: string
          unit_price_cents?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          customer_user_id: string | null
          fulfilled_at: string | null
          id: string
          metadata: Json
          notes: string | null
          paid_at: string | null
          payment_method: string
          payment_ref: string | null
          shipping_address: Json | null
          shipping_cost_cents: number
          shipping_method: string | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents: number
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_user_id?: string | null
          fulfilled_at?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          paid_at?: string | null
          payment_method?: string
          payment_ref?: string | null
          shipping_address?: Json | null
          shipping_cost_cents?: number
          shipping_method?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents?: number
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_user_id?: string | null
          fulfilled_at?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          paid_at?: string | null
          payment_method?: string
          payment_ref?: string | null
          shipping_address?: Json | null
          shipping_cost_cents?: number
          shipping_method?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id?: string
          total_cents?: number
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_messages: {
        Row: {
          actual_revenue_cents: number | null
          body: string
          channel: string
          channel_message_id: string | null
          converted_at: string | null
          created_at: string
          customer_id: string | null
          error: string | null
          expected_impact_cents: number | null
          id: string
          metadata: Json
          related_product_id: string | null
          replied_at: string | null
          scheduled_for: string
          sent_at: string | null
          source_action_id: string | null
          source_insight_id: string | null
          status: string
          template_key: string | null
          tenant_id: string
          trigger_kind: string
          updated_at: string
        }
        Insert: {
          actual_revenue_cents?: number | null
          body: string
          channel: string
          channel_message_id?: string | null
          converted_at?: string | null
          created_at?: string
          customer_id?: string | null
          error?: string | null
          expected_impact_cents?: number | null
          id?: string
          metadata?: Json
          related_product_id?: string | null
          replied_at?: string | null
          scheduled_for?: string
          sent_at?: string | null
          source_action_id?: string | null
          source_insight_id?: string | null
          status?: string
          template_key?: string | null
          tenant_id: string
          trigger_kind: string
          updated_at?: string
        }
        Update: {
          actual_revenue_cents?: number | null
          body?: string
          channel?: string
          channel_message_id?: string | null
          converted_at?: string | null
          created_at?: string
          customer_id?: string | null
          error?: string | null
          expected_impact_cents?: number | null
          id?: string
          metadata?: Json
          related_product_id?: string | null
          replied_at?: string | null
          scheduled_for?: string
          sent_at?: string | null
          source_action_id?: string | null
          source_insight_id?: string | null
          status?: string
          template_key?: string | null
          tenant_id?: string
          trigger_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_related_product_id_fkey"
            columns: ["related_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "outbound_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_actions: {
        Row: {
          action_type: string
          channel: string
          created_at: string
          draft_alt_text: string | null
          draft_text: string
          failed_reason: string | null
          id: string
          landing_url: string
          lead_id: string
          posted_at: string | null
          posted_url: string | null
          promo_code: string | null
          retry_count: number
          scheduled_for: string | null
          status: string
          tenant_id: string
          tone: string | null
          tribunal_case_id: string | null
          tribunal_verdict: string | null
          updated_at: string
          utm_campaign: string
        }
        Insert: {
          action_type: string
          channel: string
          created_at?: string
          draft_alt_text?: string | null
          draft_text: string
          failed_reason?: string | null
          id?: string
          landing_url: string
          lead_id: string
          posted_at?: string | null
          posted_url?: string | null
          promo_code?: string | null
          retry_count?: number
          scheduled_for?: string | null
          status?: string
          tenant_id: string
          tone?: string | null
          tribunal_case_id?: string | null
          tribunal_verdict?: string | null
          updated_at?: string
          utm_campaign: string
        }
        Update: {
          action_type?: string
          channel?: string
          created_at?: string
          draft_alt_text?: string | null
          draft_text?: string
          failed_reason?: string | null
          id?: string
          landing_url?: string
          lead_id?: string
          posted_at?: string | null
          posted_url?: string | null
          promo_code?: string | null
          retry_count?: number
          scheduled_for?: string | null
          status?: string
          tenant_id?: string
          tone?: string | null
          tribunal_case_id?: string | null
          tribunal_verdict?: string | null
          updated_at?: string
          utm_campaign?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_actions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "outreach_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "outreach_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_leads: {
        Row: {
          author_handle: string | null
          author_url: string | null
          channel: string
          content: string
          created_at: string
          discovered_at: string
          fingerprint: string
          geo_city: string | null
          geo_country: string | null
          id: string
          intent_score: number
          language: string | null
          matched_keywords: string[]
          raw_payload: Json
          source_platform_id: string | null
          source_url: string
          status: string
          tenant_id: string
          title: string | null
          topic_tags: string[]
          updated_at: string
        }
        Insert: {
          author_handle?: string | null
          author_url?: string | null
          channel: string
          content: string
          created_at?: string
          discovered_at?: string
          fingerprint: string
          geo_city?: string | null
          geo_country?: string | null
          id?: string
          intent_score?: number
          language?: string | null
          matched_keywords?: string[]
          raw_payload?: Json
          source_platform_id?: string | null
          source_url: string
          status?: string
          tenant_id: string
          title?: string | null
          topic_tags?: string[]
          updated_at?: string
        }
        Update: {
          author_handle?: string | null
          author_url?: string | null
          channel?: string
          content?: string
          created_at?: string
          discovered_at?: string
          fingerprint?: string
          geo_city?: string | null
          geo_country?: string | null
          id?: string
          intent_score?: number
          language?: string | null
          matched_keywords?: string[]
          raw_payload?: Json
          source_platform_id?: string | null
          source_url?: string
          status?: string
          tenant_id?: string
          title?: string | null
          topic_tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "outreach_leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_metrics: {
        Row: {
          action_id: string
          add_to_cart: number
          channel: string
          clicks: number
          computed_at: string
          conversion_rate: number
          created_at: string
          ctr: number
          id: string
          impressions: number
          lead_id: string
          orders_count: number
          revenue: number
          roi_per_action: number
          tenant_id: string
          updated_at: string
          utm_campaign: string
          visits: number
        }
        Insert: {
          action_id: string
          add_to_cart?: number
          channel: string
          clicks?: number
          computed_at?: string
          conversion_rate?: number
          created_at?: string
          ctr?: number
          id?: string
          impressions?: number
          lead_id: string
          orders_count?: number
          revenue?: number
          roi_per_action?: number
          tenant_id: string
          updated_at?: string
          utm_campaign: string
          visits?: number
        }
        Update: {
          action_id?: string
          add_to_cart?: number
          channel?: string
          clicks?: number
          computed_at?: string
          conversion_rate?: number
          created_at?: string
          ctr?: number
          id?: string
          impressions?: number
          lead_id?: string
          orders_count?: number
          revenue?: number
          roi_per_action?: number
          tenant_id?: string
          updated_at?: string
          utm_campaign?: string
          visits?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_metrics_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "outreach_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_metrics_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "outreach_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "outreach_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_settings: {
        Row: {
          description: string | null
          key: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          description?: string | null
          key?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "outreach_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "outreach_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_notifications: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          id: string
          is_read: boolean
          kind: string
          link: string | null
          metadata: Json
          severity: string
          tenant_id: string
          title: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          channel?: string
          created_at?: string
          id?: string
          is_read?: boolean
          kind: string
          link?: string | null
          metadata?: Json
          severity?: string
          tenant_id: string
          title: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          id?: string
          is_read?: boolean
          kind?: string
          link?: string | null
          metadata?: Json
          severity?: string
          tenant_id?: string
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "owner_notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_telegram_outbox: {
        Row: {
          attempts: number
          chat_id: string | null
          created_at: string
          error: string | null
          id: string
          next_retry_at: string | null
          payload: Json
          sent_at: string | null
          source_id: string
          source_kind: string
          status: string
          tenant_id: string
          tg_message_id: number | null
        }
        Insert: {
          attempts?: number
          chat_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          next_retry_at?: string | null
          payload?: Json
          sent_at?: string | null
          source_id: string
          source_kind: string
          status?: string
          tenant_id: string
          tg_message_id?: number | null
        }
        Update: {
          attempts?: number
          chat_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          next_retry_at?: string | null
          payload?: Json
          sent_at?: string | null
          source_id?: string
          source_kind?: string
          status?: string
          tenant_id?: string
          tg_message_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_telegram_outbox_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "owner_telegram_outbox_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_callbacks_log: {
        Row: {
          created_at: string
          external_id: string | null
          http_status: number
          id: string
          ip: string | null
          order_id: string | null
          parsed_payload: Json
          provider: string
          raw_body: string | null
          signature_valid: boolean
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          http_status?: number
          id?: string
          ip?: string | null
          order_id?: string | null
          parsed_payload?: Json
          provider: string
          raw_body?: string | null
          signature_valid?: boolean
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          external_id?: string | null
          http_status?: number
          id?: string
          ip?: string | null
          order_id?: string | null
          parsed_payload?: Json
          provider?: string
          raw_body?: string | null
          signature_valid?: boolean
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_callbacks_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_callbacks_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "payment_callbacks_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_intents: {
        Row: {
          amount_cents: number
          callback_payload: Json
          completed_at: string | null
          created_at: string
          currency: string
          error_message: string | null
          external_id: string | null
          id: string
          order_id: string
          provider: string
          redirect_url: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          callback_payload?: Json
          completed_at?: string | null
          created_at?: string
          currency?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          order_id: string
          provider: string
          redirect_url?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          callback_payload?: Json
          completed_at?: string | null
          created_at?: string
          currency?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          order_id?: string
          provider?: string
          redirect_url?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "payment_intents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_change_log: {
        Row: {
          actor_user_id: string | null
          created_at: string
          from_plan_id: string | null
          id: string
          reason: string | null
          tenant_id: string
          to_plan_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          from_plan_id?: string | null
          id?: string
          reason?: string | null
          tenant_id: string
          to_plan_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          from_plan_id?: string | null
          id?: string
          reason?: string | null
          tenant_id?: string
          to_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_change_log_from_plan_id_fkey"
            columns: ["from_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_change_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "plan_change_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_change_log_to_plan_id_fkey"
            columns: ["to_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          agents_allowed: string[]
          created_at: string
          currency: string
          description: string | null
          features_enabled: string[]
          id: string
          is_active: boolean
          is_public: boolean
          key: string
          max_ai_credits_monthly_grant: number
          max_ai_runs_per_month: number | null
          max_customers: number | null
          max_orders_per_month: number | null
          max_outbound_messages_per_month: number | null
          max_products: number | null
          max_storage_mb: number | null
          max_team_members: number | null
          metadata: Json
          name: string
          price_cents_monthly: number
          price_cents_yearly: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          agents_allowed?: string[]
          created_at?: string
          currency?: string
          description?: string | null
          features_enabled?: string[]
          id?: string
          is_active?: boolean
          is_public?: boolean
          key: string
          max_ai_credits_monthly_grant?: number
          max_ai_runs_per_month?: number | null
          max_customers?: number | null
          max_orders_per_month?: number | null
          max_outbound_messages_per_month?: number | null
          max_products?: number | null
          max_storage_mb?: number | null
          max_team_members?: number | null
          metadata?: Json
          name: string
          price_cents_monthly?: number
          price_cents_yearly?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          agents_allowed?: string[]
          created_at?: string
          currency?: string
          description?: string | null
          features_enabled?: string[]
          id?: string
          is_active?: boolean
          is_public?: boolean
          key?: string
          max_ai_credits_monthly_grant?: number
          max_ai_runs_per_month?: number | null
          max_customers?: number | null
          max_orders_per_month?: number | null
          max_outbound_messages_per_month?: number | null
          max_products?: number | null
          max_storage_mb?: number | null
          max_team_members?: number | null
          metadata?: Json
          name?: string
          price_cents_monthly?: number
          price_cents_yearly?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      price_elasticity: {
        Row: {
          computed_at: string
          confidence: number
          created_at: string
          data_window_days: number
          elasticity: number
          id: string
          optimal_price_cents: number | null
          product_id: string
          sample_size: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          computed_at?: string
          confidence?: number
          created_at?: string
          data_window_days?: number
          elasticity?: number
          id?: string
          optimal_price_cents?: number | null
          product_id: string
          sample_size?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          computed_at?: string
          confidence?: number
          created_at?: string
          data_window_days?: number
          elasticity?: number
          id?: string
          optimal_price_cents?: number | null
          product_id?: string
          sample_size?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_elasticity_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_elasticity_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "price_elasticity_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_decisions: {
        Row: {
          agent: string
          applied_at: string
          created_at: string
          elasticity_estimate: number | null
          expected_margin_lift_pct: number | null
          expected_volume_lift_pct: number | null
          id: string
          measured_revenue_lift_cents: number | null
          new_price_cents: number
          old_price_cents: number
          product_id: string
          reason: string
          reverted_at: string | null
          tenant_id: string
        }
        Insert: {
          agent: string
          applied_at?: string
          created_at?: string
          elasticity_estimate?: number | null
          expected_margin_lift_pct?: number | null
          expected_volume_lift_pct?: number | null
          id?: string
          measured_revenue_lift_cents?: number | null
          new_price_cents: number
          old_price_cents: number
          product_id: string
          reason: string
          reverted_at?: string | null
          tenant_id: string
        }
        Update: {
          agent?: string
          applied_at?: string
          created_at?: string
          elasticity_estimate?: number | null
          expected_margin_lift_pct?: number | null
          expected_volume_lift_pct?: number | null
          id?: string
          measured_revenue_lift_cents?: number | null
          new_price_cents?: number
          old_price_cents?: number
          product_id?: string
          reason?: string
          reverted_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_decisions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_decisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "pricing_decisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_affinity: {
        Row: {
          co_purchase_count: number
          computed_at: string
          id: string
          lift_score: number
          product_a_id: string
          product_b_id: string
          tenant_id: string
        }
        Insert: {
          co_purchase_count?: number
          computed_at?: string
          id?: string
          lift_score?: number
          product_a_id: string
          product_b_id: string
          tenant_id: string
        }
        Update: {
          co_purchase_count?: number
          computed_at?: string
          id?: string
          lift_score?: number
          product_a_id?: string
          product_b_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_affinity_product_a_id_fkey"
            columns: ["product_a_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_affinity_product_b_id_fkey"
            columns: ["product_b_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_affinity_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "product_affinity_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_bundles: {
        Row: {
          affinity_score: number
          agent: string | null
          bundle_price_cents: number
          created_at: string
          id: string
          individual_price_cents: number
          is_active: boolean
          is_auto_generated: boolean
          name: string
          product_ids: string[]
          revenue_cents: number
          tenant_id: string
          times_purchased: number
          updated_at: string
        }
        Insert: {
          affinity_score?: number
          agent?: string | null
          bundle_price_cents?: number
          created_at?: string
          id?: string
          individual_price_cents?: number
          is_active?: boolean
          is_auto_generated?: boolean
          name: string
          product_ids?: string[]
          revenue_cents?: number
          tenant_id: string
          times_purchased?: number
          updated_at?: string
        }
        Update: {
          affinity_score?: number
          agent?: string | null
          bundle_price_cents?: number
          created_at?: string
          id?: string
          individual_price_cents?: number
          is_active?: boolean
          is_auto_generated?: boolean
          name?: string
          product_ids?: string[]
          revenue_cents?: number
          tenant_id?: string
          times_purchased?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_bundles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "product_bundles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_costs: {
        Row: {
          cost_cents: number
          created_at: string
          effective_from: string
          effective_to: string | null
          fulfillment_cost_cents: number
          id: string
          notes: string | null
          product_id: string
          shipping_cost_cents: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cost_cents?: number
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          fulfillment_cost_cents?: number
          id?: string
          notes?: string | null
          product_id: string
          shipping_cost_cents?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cost_cents?: number
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          fulfillment_cost_cents?: number
          id?: string
          notes?: string | null
          product_id?: string
          shipping_cost_cents?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_costs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "product_costs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt: string | null
          created_at: string
          id: string
          is_primary: boolean
          position: number
          product_id: string
          tenant_id: string
          url: string
        }
        Insert: {
          alt?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          position?: number
          product_id: string
          tenant_id: string
          url: string
        }
        Update: {
          alt?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          position?: number
          product_id?: string
          tenant_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "product_images_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_metrics_14d: {
        Row: {
          add_to_cart: number
          computed_at: string
          conversion_rate: number
          current_stock: number | null
          is_stocked_out: boolean
          orders_count: number
          product_id: string
          revenue_cents: number
          tenant_id: string
          units_sold: number
          views: number
          window_end: string
          window_start: string
        }
        Insert: {
          add_to_cart?: number
          computed_at?: string
          conversion_rate?: number
          current_stock?: number | null
          is_stocked_out?: boolean
          orders_count?: number
          product_id: string
          revenue_cents?: number
          tenant_id: string
          units_sold?: number
          views?: number
          window_end: string
          window_start: string
        }
        Update: {
          add_to_cart?: number
          computed_at?: string
          conversion_rate?: number
          current_stock?: number | null
          is_stocked_out?: boolean
          orders_count?: number
          product_id?: string
          revenue_cents?: number
          tenant_id?: string
          units_sold?: number
          views?: number
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          compare_at_price_cents: number | null
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          metadata: Json
          option_1_name: string | null
          option_1_value: string | null
          option_2_name: string | null
          option_2_value: string | null
          option_3_name: string | null
          option_3_value: string | null
          price_cents: number
          product_id: string
          sku: string | null
          stock: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          compare_at_price_cents?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          metadata?: Json
          option_1_name?: string | null
          option_1_value?: string | null
          option_2_name?: string | null
          option_2_value?: string | null
          option_3_name?: string | null
          option_3_value?: string | null
          price_cents?: number
          product_id: string
          sku?: string | null
          stock?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          compare_at_price_cents?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          metadata?: Json
          option_1_name?: string | null
          option_1_value?: string | null
          option_2_name?: string | null
          option_2_value?: string | null
          option_3_name?: string | null
          option_3_value?: string | null
          price_cents?: number
          product_id?: string
          sku?: string | null
          stock?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "product_variants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          compare_at_price_cents: number | null
          created_at: string
          currency: string
          description: string | null
          has_variants: boolean
          id: string
          image_url: string | null
          is_active: boolean
          metadata: Json
          name: string
          price_cents: number
          seo_description: string | null
          seo_title: string | null
          sku: string | null
          stock: number
          tags: string[]
          tenant_id: string
          updated_at: string
          url_handle: string | null
          was_out_of_stock: boolean
          weight_grams: number | null
        }
        Insert: {
          compare_at_price_cents?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          has_variants?: boolean
          id?: string
          image_url?: string | null
          is_active?: boolean
          metadata?: Json
          name: string
          price_cents?: number
          seo_description?: string | null
          seo_title?: string | null
          sku?: string | null
          stock?: number
          tags?: string[]
          tenant_id: string
          updated_at?: string
          url_handle?: string | null
          was_out_of_stock?: boolean
          weight_grams?: number | null
        }
        Update: {
          compare_at_price_cents?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          has_variants?: boolean
          id?: string
          image_url?: string | null
          is_active?: boolean
          metadata?: Json
          name?: string
          price_cents?: number
          seo_description?: string | null
          seo_title?: string | null
          sku?: string | null
          stock?: number
          tags?: string[]
          tenant_id?: string
          updated_at?: string
          url_handle?: string | null
          was_out_of_stock?: boolean
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          agent: string | null
          applies_to_product_ids: string[] | null
          applies_to_segment: string | null
          code: string | null
          cost_cents: number
          created_at: string
          ends_at: string | null
          fatigue_score: number
          id: string
          is_active: boolean
          min_order_cents: number
          name: string
          promo_type: string
          revenue_cents: number
          starts_at: string
          tenant_id: string
          times_used: number
          updated_at: string
          usage_limit: number | null
          usage_per_customer: number
          value: number
        }
        Insert: {
          agent?: string | null
          applies_to_product_ids?: string[] | null
          applies_to_segment?: string | null
          code?: string | null
          cost_cents?: number
          created_at?: string
          ends_at?: string | null
          fatigue_score?: number
          id?: string
          is_active?: boolean
          min_order_cents?: number
          name: string
          promo_type?: string
          revenue_cents?: number
          starts_at?: string
          tenant_id: string
          times_used?: number
          updated_at?: string
          usage_limit?: number | null
          usage_per_customer?: number
          value?: number
        }
        Update: {
          agent?: string | null
          applies_to_product_ids?: string[] | null
          applies_to_segment?: string | null
          code?: string | null
          cost_cents?: number
          created_at?: string
          ends_at?: string | null
          fatigue_score?: number
          id?: string
          is_active?: boolean
          min_order_cents?: number
          name?: string
          promo_type?: string
          revenue_cents?: number
          starts_at?: string
          tenant_id?: string
          times_used?: number
          updated_at?: string
          usage_limit?: number | null
          usage_per_customer?: number
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "promotions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "promotions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      restock_notifications: {
        Row: {
          created_at: string
          customer_email: string
          customer_id: string | null
          id: string
          notified_at: string | null
          product_id: string
          status: string
          tenant_id: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          customer_email: string
          customer_id?: string | null
          id?: string
          notified_at?: string | null
          product_id: string
          status?: string
          tenant_id: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          customer_email?: string
          customer_id?: string | null
          id?: string
          notified_at?: string | null
          product_id?: string
          status?: string
          tenant_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restock_notifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restock_notifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restock_notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "restock_notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restock_notifications_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      restock_subscribe_rate_limit: {
        Row: {
          bucket_hour: string
          count: number
          id: number
          ip_hash: string
        }
        Insert: {
          bucket_hour: string
          count?: number
          id?: number
          ip_hash: string
        }
        Update: {
          bucket_hour?: string
          count?: number
          id?: number
          ip_hash?: string
        }
        Relationships: []
      }
      search_queries: {
        Row: {
          clicked: boolean
          created_at: string
          customer_id: string | null
          id: string
          led_to_purchase: boolean
          occurred_at: string
          query: string
          result_count: number | null
          source: string
          tenant_id: string
        }
        Insert: {
          clicked?: boolean
          created_at?: string
          customer_id?: string | null
          id?: string
          led_to_purchase?: boolean
          occurred_at?: string
          query: string
          result_count?: number | null
          source?: string
          tenant_id: string
        }
        Update: {
          clicked?: boolean
          created_at?: string
          customer_id?: string | null
          id?: string
          led_to_purchase?: boolean
          occurred_at?: string
          query?: string
          result_count?: number | null
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_queries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_queries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "search_queries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      self_heal_actions: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          created_at: string
          decision: string
          id: string
          incident_id: string | null
          kind: string
          payload_json: Json
          result_text: string | null
          reversible: boolean
          revert_payload: Json | null
          reverted_at: string | null
          reverted_by: string | null
          status: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          decision: string
          id?: string
          incident_id?: string | null
          kind: string
          payload_json?: Json
          result_text?: string | null
          reversible?: boolean
          revert_payload?: Json | null
          reverted_at?: string | null
          reverted_by?: string | null
          status?: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          decision?: string
          id?: string
          incident_id?: string | null
          kind?: string
          payload_json?: Json
          result_text?: string | null
          reversible?: boolean
          revert_payload?: Json | null
          reverted_at?: string | null
          reverted_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "self_heal_actions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "self_heal_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      self_heal_incidents: {
        Row: {
          created_at: string
          detector: string
          fingerprint: string
          first_seen_at: string
          id: string
          inc_code: string
          last_seen_at: string
          occurrences: number
          regression_risk: string
          resolved_at: string | null
          root_cause: string | null
          scope_json: Json
          severity: string
          status: string
          tenant_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          detector: string
          fingerprint: string
          first_seen_at?: string
          id?: string
          inc_code: string
          last_seen_at?: string
          occurrences?: number
          regression_risk?: string
          resolved_at?: string | null
          root_cause?: string | null
          scope_json?: Json
          severity: string
          status?: string
          tenant_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          detector?: string
          fingerprint?: string
          first_seen_at?: string
          id?: string
          inc_code?: string
          last_seen_at?: string
          occurrences?: number
          regression_risk?: string
          resolved_at?: string | null
          root_cause?: string | null
          scope_json?: Json
          severity?: string
          status?: string
          tenant_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      self_heal_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      site_brand_profiles: {
        Row: {
          about_copy: string | null
          accent_color: string
          address: string | null
          brand_name: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          currency: string
          custom_domain: string | null
          description: string | null
          favicon_url: string | null
          font_family: string
          food_categories_seed: Json
          hero_copy: string | null
          id: string
          legal_entity: string | null
          legal_pages: Json
          locale: string
          logo_url: string | null
          niche_profile: Json
          og_image_url: string | null
          primary_color: string
          social_links: Json
          tagline: string | null
          template_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          about_copy?: string | null
          accent_color?: string
          address?: string | null
          brand_name: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          custom_domain?: string | null
          description?: string | null
          favicon_url?: string | null
          font_family?: string
          food_categories_seed?: Json
          hero_copy?: string | null
          id?: string
          legal_entity?: string | null
          legal_pages?: Json
          locale?: string
          logo_url?: string | null
          niche_profile?: Json
          og_image_url?: string | null
          primary_color?: string
          social_links?: Json
          tagline?: string | null
          template_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          about_copy?: string | null
          accent_color?: string
          address?: string | null
          brand_name?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          custom_domain?: string | null
          description?: string | null
          favicon_url?: string | null
          font_family?: string
          food_categories_seed?: Json
          hero_copy?: string | null
          id?: string
          legal_entity?: string | null
          legal_pages?: Json
          locale?: string
          logo_url?: string | null
          niche_profile?: Json
          og_image_url?: string | null
          primary_color?: string
          social_links?: Json
          tagline?: string | null
          template_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_brand_profiles_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "site_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_brand_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "site_brand_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      site_builds: {
        Row: {
          archive_path: string | null
          archive_sha256: string | null
          archive_size_bytes: number | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          manifest: Json
          requested_by: string | null
          started_at: string | null
          status: string
          template_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          archive_path?: string | null
          archive_sha256?: string | null
          archive_size_bytes?: number | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          manifest?: Json
          requested_by?: string | null
          started_at?: string | null
          status?: string
          template_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          archive_path?: string | null
          archive_sha256?: string | null
          archive_size_bytes?: number | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          manifest?: Json
          requested_by?: string | null
          started_at?: string | null
          status?: string
          template_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_builds_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "site_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_builds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "site_builds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      site_templates: {
        Row: {
          capabilities: Json
          created_at: string
          default_locale: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          preview_url: string | null
          source_commit: string | null
          source_project_id: string | null
          template_key: string
          updated_at: string
        }
        Insert: {
          capabilities?: Json
          created_at?: string
          default_locale?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          preview_url?: string | null
          source_commit?: string | null
          source_project_id?: string | null
          template_key: string
          updated_at?: string
        }
        Update: {
          capabilities?: Json
          created_at?: string
          default_locale?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          preview_url?: string | null
          source_commit?: string | null
          source_project_id?: string | null
          template_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      social_proof_events: {
        Row: {
          created_at: string
          display_text: string
          event_type: string
          expires_at: string | null
          id: string
          is_active: boolean
          metadata: Json
          product_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          display_text: string
          event_type: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          product_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          display_text?: string
          event_type?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          product_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_proof_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_proof_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "social_proof_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_bot_state: {
        Row: {
          id: number
          update_offset: number
          updated_at: string
        }
        Insert: {
          id: number
          update_offset?: number
          updated_at?: string
        }
        Update: {
          id?: number
          update_offset?: number
          updated_at?: string
        }
        Relationships: []
      }
      telegram_chat_routing: {
        Row: {
          chat_id: string
          created_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_chat_routing_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "telegram_chat_routing_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_owner_pairings: {
        Row: {
          consumed_at: string | null
          consumed_chat_id: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          pairing_code: string
          tenant_id: string
        }
        Insert: {
          consumed_at?: string | null
          consumed_chat_id?: string | null
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          pairing_code: string
          tenant_id: string
        }
        Update: {
          consumed_at?: string | null
          consumed_chat_id?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          pairing_code?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_owner_pairings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "telegram_owner_pairings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          tenant_id: string
          tier: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id: string
          tier?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id?: string
          tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_api_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_api_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_balances: {
        Row: {
          ai_credits_balance: number
          ai_credits_consumed_this_period: number
          ai_credits_granted_this_period: number
          currency: string
          last_grant_at: string | null
          money_balance_cents: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ai_credits_balance?: number
          ai_credits_consumed_this_period?: number
          ai_credits_granted_this_period?: number
          currency?: string
          last_grant_at?: string | null
          money_balance_cents?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ai_credits_balance?: number
          ai_credits_consumed_this_period?: number
          ai_credits_granted_this_period?: number
          currency?: string
          last_grant_at?: string | null
          money_balance_cents?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_configs: {
        Row: {
          bot: Json
          brand_name: string
          created_at: string
          features: Json
          geo_targets: Json
          owner_telegram_chat_id: string | null
          seo: Json
          tenant_id: string
          ui: Json
          updated_at: string
        }
        Insert: {
          bot?: Json
          brand_name: string
          created_at?: string
          features?: Json
          geo_targets?: Json
          owner_telegram_chat_id?: string | null
          seo?: Json
          tenant_id: string
          ui?: Json
          updated_at?: string
        }
        Update: {
          bot?: Json
          brand_name?: string
          created_at?: string
          features?: Json
          geo_targets?: Json
          owner_telegram_chat_id?: string | null
          seo?: Json
          tenant_id?: string
          ui?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_domains: {
        Row: {
          created_at: string
          domain: string
          id: string
          is_primary: boolean
          last_checked_at: string | null
          notes: string | null
          status: string
          tenant_id: string
          updated_at: string
          verification_token: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          is_primary?: boolean
          last_checked_at?: string | null
          notes?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          verification_token?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          is_primary?: boolean
          last_checked_at?: string | null
          notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          verification_token?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_integrations: {
        Row: {
          config: Json
          created_at: string
          credentials_encrypted: string | null
          id: string
          is_active: boolean
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          provider: string
          synced_customers_count: number
          synced_orders_count: number
          synced_products_count: number
          tenant_id: string
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          credentials_encrypted?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          provider: string
          synced_customers_count?: number
          synced_orders_count?: number
          synced_products_count?: number
          tenant_id: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          credentials_encrypted?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          provider?: string
          synced_customers_count?: number
          synced_orders_count?: number
          synced_products_count?: number
          tenant_id?: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: string
          status: string
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          status?: string
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          status?: string
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          notes: string | null
          overrides: Json
          plan_id: string
          status: string
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          notes?: string | null
          overrides?: Json
          plan_id: string
          status?: string
          tenant_id: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          notes?: string | null
          overrides?: Json
          plan_id?: string
          status?: string
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_usage_counters: {
        Row: {
          id: string
          metric: string
          period_start: string
          tenant_id: string
          updated_at: string
          value: number
        }
        Insert: {
          id?: string
          metric: string
          period_start: string
          tenant_id: string
          updated_at?: string
          value?: number
        }
        Update: {
          id?: string
          metric?: string
          period_start?: string
          tenant_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_usage_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_usage_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          is_pilot: boolean
          name: string
          owner_user_id: string
          rejection_reason: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
          verification_requested_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_pilot?: boolean
          name: string
          owner_user_id: string
          rejection_reason?: string | null
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
          verification_requested_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_pilot?: boolean
          name?: string
          owner_user_id?: string
          rejection_reason?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
          verification_requested_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      tg_user_action_log: {
        Row: {
          action_id: string | null
          action_type: string
          agent_id: string | null
          created_at: string
          duration_ms: number | null
          id: string
          origin: string | null
          result: Json
          status: string
          target: Json
          tenant_id: string
        }
        Insert: {
          action_id?: string | null
          action_type: string
          agent_id?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          origin?: string | null
          result?: Json
          status: string
          target?: Json
          tenant_id: string
        }
        Update: {
          action_id?: string | null
          action_type?: string
          agent_id?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          origin?: string | null
          result?: Json
          status?: string
          target?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tg_user_action_log_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "tg_user_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tg_user_action_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tg_user_action_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tg_user_actions: {
        Row: {
          action_type: string
          agent_id: string | null
          attempts: number
          created_at: string
          executed_at: string | null
          id: string
          last_error: string | null
          max_attempts: number
          origin: string
          payload: Json
          requested_by: string | null
          result: Json
          scheduled_for: string
          session_id: string | null
          status: string
          target: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          action_type: string
          agent_id?: string | null
          attempts?: number
          created_at?: string
          executed_at?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          origin?: string
          payload?: Json
          requested_by?: string | null
          result?: Json
          scheduled_for?: string
          session_id?: string | null
          status?: string
          target?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          agent_id?: string | null
          attempts?: number
          created_at?: string
          executed_at?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          origin?: string
          payload?: Json
          requested_by?: string | null
          result?: Json
          scheduled_for?: string
          session_id?: string | null
          status?: string
          target?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tg_user_actions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "tg_user_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tg_user_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tg_user_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tg_user_quotas: {
        Row: {
          agent_autonomy_enabled: boolean
          agent_max_per_day: number
          auto_pause_after_errors: number
          created_at: string
          delay_max_seconds: number
          delay_min_seconds: number
          max_comment_per_day: number
          max_comment_per_hour: number
          max_dm_per_day: number
          max_dm_per_hour: number
          max_join_per_day: number
          max_reaction_per_day: number
          max_reaction_per_hour: number
          paused_reason: string | null
          paused_until: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          agent_autonomy_enabled?: boolean
          agent_max_per_day?: number
          auto_pause_after_errors?: number
          created_at?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          max_comment_per_day?: number
          max_comment_per_hour?: number
          max_dm_per_day?: number
          max_dm_per_hour?: number
          max_join_per_day?: number
          max_reaction_per_day?: number
          max_reaction_per_hour?: number
          paused_reason?: string | null
          paused_until?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          agent_autonomy_enabled?: boolean
          agent_max_per_day?: number
          auto_pause_after_errors?: number
          created_at?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          max_comment_per_day?: number
          max_comment_per_hour?: number
          max_dm_per_day?: number
          max_dm_per_hour?: number
          max_join_per_day?: number
          max_reaction_per_day?: number
          max_reaction_per_hour?: number
          paused_reason?: string | null
          paused_until?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tg_user_quotas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tg_user_quotas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tg_user_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          dc_id: number | null
          encrypted_session: string | null
          first_name: string | null
          id: string
          last_error: string | null
          last_used_at: string | null
          login_state: Json
          phone: string
          status: string
          tenant_id: string
          updated_at: string
          user_id_tg: number | null
          username: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dc_id?: number | null
          encrypted_session?: string | null
          first_name?: string | null
          id?: string
          last_error?: string | null
          last_used_at?: string | null
          login_state?: Json
          phone: string
          status?: string
          tenant_id: string
          updated_at?: string
          user_id_tg?: number | null
          username?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dc_id?: number | null
          encrypted_session?: string | null
          first_name?: string | null
          id?: string
          last_error?: string | null
          last_used_at?: string | null
          login_state?: Json
          phone?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id_tg?: number | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tg_user_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tg_user_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      topup_requests: {
        Row: {
          amount_cents: number
          contact: string | null
          created_at: string
          credits: number
          currency: string
          handled_at: string | null
          handled_by: string | null
          id: string
          manager_note: string | null
          note: string | null
          payment_method: string
          processed_at: string | null
          processed_by: string | null
          requested_by: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          contact?: string | null
          created_at?: string
          credits: number
          currency?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          manager_note?: string | null
          note?: string | null
          payment_method?: string
          processed_at?: string | null
          processed_by?: string | null
          requested_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          contact?: string | null
          created_at?: string
          credits?: number
          currency?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          manager_note?: string | null
          note?: string | null
          payment_method?: string
          processed_at?: string | null
          processed_by?: string | null
          requested_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topup_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "topup_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ugc_items: {
        Row: {
          body: string | null
          created_at: string
          customer_id: string | null
          id: string
          is_approved: boolean
          is_featured: boolean
          media_urls: string[] | null
          product_id: string | null
          rating: number | null
          source: string
          tenant_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          is_approved?: boolean
          is_featured?: boolean
          media_urls?: string[] | null
          product_id?: string | null
          rating?: number | null
          source?: string
          tenant_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          is_approved?: boolean
          is_featured?: boolean
          media_urls?: string[] | null
          product_id?: string | null
          rating?: number | null
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ugc_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ugc_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ugc_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "acos_loop_overview"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ugc_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string
          email_notifications: boolean
          locale: string
          marketing_opt_in: boolean
          telegram_notifications: boolean
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_notifications?: boolean
          locale?: string
          marketing_opt_in?: boolean
          telegram_notifications?: boolean
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_notifications?: boolean
          locale?: string
          marketing_opt_in?: boolean
          telegram_notifications?: boolean
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      acos_loop_activity: {
        Row: {
          detail: string | null
          event_at: string | null
          event_type: string | null
          layer: string | null
          ref_id: string | null
          risk_level: string | null
          subtype: string | null
          tenant_id: string | null
          title: string | null
        }
        Relationships: []
      }
      acos_loop_overview: {
        Row: {
          attributed_revenue_cents: number | null
          decisions_30d: number | null
          decisions_approved: number | null
          decisions_done: number | null
          decisions_failed: number | null
          decisions_pending: number | null
          decisions_rejected: number | null
          insights_30d: number | null
          insights_new: number | null
          outcomes_measured: number | null
          outcomes_success: number | null
          outcomes_total: number | null
          success_rate: number | null
          tenant_id: string | null
          tenant_name: string | null
        }
        Relationships: []
      }
      agent_performance_30d: {
        Row: {
          action_type: string | null
          agent_id: string | null
          executions: number | null
          last_measured_at: string | null
          measured: number | null
          revenue_cents: number | null
          success_rate: number | null
          successes: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _agent_slug_for: { Args: { _agent_id: string }; Returns: string }
      _decision_semantic_key: {
        Args: { _action_type: string; _insight_type: string; _payload: Json }
        Returns: string
      }
      _decision_semantic_key_full: {
        Args: {
          _action_type: string
          _insight_type: string
          _payload: Json
          _title: string
        }
        Returns: string
      }
      _high_impact_agent_for: {
        Args: { _action_type: string }
        Returns: string
      }
      _is_in_db_safe_action: { Args: { _t: string }; Returns: boolean }
      _map_insight_to_action: {
        Args: { _insight_type: string }
        Returns: string
      }
      accept_tenant_invitation: { Args: { _token: string }; Returns: Json }
      add_balance: {
        Args: {
          _amount: number
          _kind: string
          _reason: string
          _reference_kind?: string
          _tenant_id: string
        }
        Returns: number
      }
      admin_adjust_ai_credits: {
        Args: { _delta: number; _reason?: string; _tenant_id: string }
        Returns: number
      }
      admin_adjust_money_balance: {
        Args: { _delta_cents: number; _reason?: string; _tenant_id: string }
        Returns: number
      }
      admin_cron_job_runs: {
        Args: { p_jobname: string; p_limit?: number }
        Returns: {
          out_end_time: string
          out_return_message: string
          out_runid: number
          out_start_time: string
          out_status: string
        }[]
      }
      admin_get_tenant_owner: {
        Args: { _tenant_id: string }
        Returns: {
          member_count: number
          owner_email: string
          owner_id: string
        }[]
      }
      admin_grant_capability: {
        Args: { _capability: string; _target_user: string }
        Returns: undefined
      }
      admin_grant_super_admin: {
        Args: { _target_user_id: string }
        Returns: undefined
      }
      admin_has_capability: {
        Args: { _capability: string; _user_id: string }
        Returns: boolean
      }
      admin_list_admin_users: {
        Args: never
        Returns: {
          capabilities: string[]
          email: string
          is_super_admin: boolean
          user_id: string
        }[]
      }
      admin_list_cron_jobs: {
        Args: never
        Returns: {
          out_active: boolean
          out_command: string
          out_jobid: number
          out_jobname: string
          out_last_run_started: string
          out_last_run_status: string
          out_runs_50: number
          out_schedule: string
          out_successes_50: number
        }[]
      }
      admin_list_pending_tenants: {
        Args: never
        Returns: {
          created_at: string
          owner_email: string
          owner_user_id: string
          tenant_id: string
          tenant_name: string
          tenant_slug: string
          verification_requested_at: string
        }[]
      }
      admin_list_tenant_invites: {
        Args: { _tenant_id: string }
        Returns: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by_email: string
          role: string
          status: string
          token: string
        }[]
      }
      admin_list_tenant_members: {
        Args: { _tenant_id: string }
        Returns: {
          email: string
          is_owner: boolean
          joined_at: string
          last_sign_in_at: string
          role: string
          user_id: string
        }[]
      }
      admin_list_user_tenants: {
        Args: { _target_user_id: string }
        Returns: {
          ai_credits_balance: number
          current_period_end: string
          money_balance_cents: number
          plan_key: string
          plan_name: string
          role: string
          subscription_status: string
          tenant_id: string
          tenant_name: string
          tenant_slug: string
          tenant_status: string
        }[]
      }
      admin_list_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          is_super_admin: boolean
          last_sign_in_at: string
          tenant_count: number
          user_id: string
        }[]
      }
      admin_list_users_for_permissions: {
        Args: { _search?: string }
        Returns: {
          capabilities: string[]
          email: string
          is_super_admin: boolean
          tenant_count: number
          user_id: string
        }[]
      }
      admin_mark_topup_paid: {
        Args: { _manager_note?: string; _request_id: string }
        Returns: Json
      }
      admin_reject_tenant: {
        Args: { _reason: string; _tenant_id: string }
        Returns: {
          created_at: string
          id: string
          is_pilot: boolean
          name: string
          owner_user_id: string
          rejection_reason: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
          verification_requested_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_repair_cron_auth: {
        Args: { new_token: string }
        Returns: {
          changed: boolean
          jobid: number
          jobname: string
          new_command: string
        }[]
      }
      admin_revoke_capability: {
        Args: { _capability: string; _target_user: string }
        Returns: undefined
      }
      admin_revoke_super_admin: {
        Args: { _target_user_id: string }
        Returns: undefined
      }
      admin_set_cron_job_command: {
        Args: { p_command: string; p_jobname: string }
        Returns: number
      }
      admin_set_tenant_status: {
        Args: { _status: string; _tenant_id: string }
        Returns: {
          created_at: string
          id: string
          is_pilot: boolean
          name: string
          owner_user_id: string
          rejection_reason: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
          verification_requested_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_verify_tenant: {
        Args: { _tenant_id: string }
        Returns: {
          created_at: string
          id: string
          is_pilot: boolean
          name: string
          owner_user_id: string
          rejection_reason: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
          verification_requested_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_decisions: { Args: { _ids: string[] }; Returns: Json }
      archive_stale_outreach_actions: { Args: never; Returns: number }
      auto_approve_eligible_decisions: {
        Args: never
        Returns: {
          approved_count: number
          by_action: Json
        }[]
      }
      can_auto_apply_action: {
        Args: {
          _agent_id: string
          _risk: Database["public"]["Enums"]["agent_risk_level"]
          _tenant_id: string
        }
        Returns: boolean
      }
      cancel_order: {
        Args: { _order_id: string }
        Returns: {
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          customer_user_id: string | null
          fulfilled_at: string | null
          id: string
          metadata: Json
          notes: string | null
          paid_at: string | null
          payment_method: string
          payment_ref: string | null
          shipping_address: Json | null
          shipping_cost_cents: number
          shipping_method: string | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents: number
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_tenant_plan: {
        Args: { _plan_key: string; _reason?: string; _tenant_id: string }
        Returns: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          notes: string | null
          overrides: Json
          plan_id: string
          status: string
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_feature_enabled: {
        Args: { _feature: string; _tenant_id: string }
        Returns: boolean
      }
      check_plan_limit: {
        Args: { _limit_key: string; _metric: string; _tenant_id: string }
        Returns: boolean
      }
      cleanup_anon_rate_limit: { Args: never; Returns: undefined }
      cleanup_restock_rate_limit: { Args: never; Returns: undefined }
      compute_agent_health_daily: {
        Args: never
        Returns: {
          rows_upserted: number
        }[]
      }
      consume_ai_credits: {
        Args: {
          _amount: number
          _reason: string
          _reference_id?: string
          _reference_kind?: string
          _tenant_id: string
        }
        Returns: boolean
      }
      convert_insights_to_decisions: {
        Args: never
        Returns: {
          by_action: Json
          converted: number
          skipped: number
        }[]
      }
      create_my_tenant: {
        Args: { _name: string; _slug: string }
        Returns: {
          created_at: string
          id: string
          is_pilot: boolean
          name: string
          owner_user_id: string
          rejection_reason: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
          verification_requested_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_payment_intent: {
        Args: {
          _amount_cents: number
          _order_id: string
          _provider: string
          _redirect_url?: string
        }
        Returns: string
      }
      create_tenant_invitation: {
        Args: { _email: string; _role?: string; _tenant_id: string }
        Returns: Json
      }
      daily_pilot_simulator: { Args: never; Returns: Json }
      demo_measure_recent_outcomes: {
        Args: never
        Returns: {
          measured_count: number
          success_count: number
        }[]
      }
      dispatch_high_impact_all_tenants: { Args: never; Returns: Json }
      dispatch_high_impact_decisions: {
        Args: { _tenant_id: string }
        Returns: {
          action_id: string
          action_type: string
          agent_id: string
          decision_id: string
        }[]
      }
      dntrade_partial_count_recent: {
        Args: { _hours?: number; _tenant_id: string }
        Returns: number
      }
      dntrade_unhealthy_streak_minutes: {
        Args: { _tenant_id: string }
        Returns: number
      }
      execute_decisions_all_tenants: { Args: never; Returns: Json }
      execute_pending_decisions: {
        Args: { _limit?: number; _tenant: string }
        Returns: number
      }
      generate_data_driven_insights: {
        Args: { _tenant_id: string }
        Returns: number
      }
      generate_insights_for_all_tenants: { Args: never; Returns: number }
      get_agent_permission: {
        Args: { _agent_id: string; _tenant_id: string }
        Returns: {
          auto_apply_max_risk: Database["public"]["Enums"]["agent_risk_level"]
          mode: Database["public"]["Enums"]["agent_mode"]
          notify_on_apply: boolean
          weekly_run_limit: number
        }[]
      }
      get_all_tenants_overview: {
        Args: never
        Returns: {
          ai_credits_balance: number
          ai_runs_this_period: number
          created_at: string
          customers_count: number
          money_balance_cents: number
          orders_this_period: number
          plan_key: string
          plan_name: string
          products_count: number
          status: string
          subscription_status: string
          tenant_id: string
          tenant_name: string
          tenant_slug: string
        }[]
      }
      get_current_usage: {
        Args: { _metric: string; _tenant_id: string }
        Returns: number
      }
      get_effective_limit: {
        Args: { _limit_key: string; _tenant_id: string }
        Returns: number
      }
      get_invitation_by_token: { Args: { _token: string }; Returns: Json }
      get_my_tenants: {
        Args: never
        Returns: {
          membership_role: string
          plan_key: string
          plan_name: string
          status: string
          tenant_id: string
          tenant_name: string
          tenant_slug: string
        }[]
      }
      get_pending_decisions: {
        Args: { _limit?: number; _tenant: string }
        Returns: {
          action_type: string
          agent_id: string
          confidence: number
          created_at: string
          expected_impact: Json
          expires_at: string
          id: string
          insight_type: string
          payload: Json
          rationale: string
          risk_level: string
          title: string
        }[]
      }
      get_public_order: { Args: { _order_id: string }; Returns: Json }
      get_storefront_bundles: {
        Args: { _slug: string }
        Returns: {
          bundle_price_cents: number
          description: string
          discount_pct: number
          id: string
          individual_price_cents: number
          name: string
          product_ids: string[]
        }[]
      }
      get_storefront_collection_products: {
        Args: { _handle: string; _slug: string }
        Returns: Json
      }
      get_storefront_collections: {
        Args: { _slug: string }
        Returns: {
          description: string
          handle: string
          id: string
          image_url: string
          name: string
          product_count: number
        }[]
      }
      get_storefront_config: { Args: { _slug: string }; Returns: Json }
      get_storefront_page: {
        Args: { _page_slug: string; _slug: string }
        Returns: {
          agent: string | null
          agent_generated: boolean
          body_md: string | null
          content_type: string
          created_at: string
          id: string
          is_published: boolean
          metadata: Json
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          tenant_id: string
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "content_pages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_storefront_product_detail: {
        Args: { _product_id: string; _slug: string }
        Returns: Json
      }
      get_storefront_products: {
        Args: { _slug: string }
        Returns: {
          currency: string
          description: string
          id: string
          image_url: string
          name: string
          price_cents: number
          stock_available: boolean
        }[]
      }
      get_storefront_products_v2: {
        Args: { _slug: string }
        Returns: {
          compare_at_price_cents: number
          currency: string
          description: string
          has_variants: boolean
          id: string
          image_url: string
          name: string
          price_cents: number
          stock: number
          tags: string[]
          url_handle: string
        }[]
      }
      get_storefront_social_proof: {
        Args: { _limit?: number; _slug: string }
        Returns: {
          created_at: string
          display_text: string
          event_type: string
          expires_at: string | null
          id: string
          is_active: boolean
          metadata: Json
          product_id: string | null
          tenant_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "social_proof_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_tenant_plan_summary: { Args: { _tenant_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_integration_rate_limit: {
        Args: {
          _max_per_minute?: number
          _provider: string
          _tenant_id: string
        }
        Returns: number
      }
      increment_usage: {
        Args: { _delta?: number; _metric: string; _tenant_id: string }
        Returns: undefined
      }
      is_email_suppressed: {
        Args: { _email: string; _tenant_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: { _tenant_id: string }; Returns: boolean }
      is_tenant_member: { Args: { _tenant_id: string }; Returns: boolean }
      mark_decision_outcome: {
        Args: {
          _actual?: Json
          _attributed_revenue_cents?: number
          _decision_id: string
          _notes?: string
          _success: boolean
        }
        Returns: undefined
      }
      mark_order_paid: {
        Args: { _order_id: string; _payment_ref?: string }
        Returns: {
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          customer_user_id: string | null
          fulfilled_at: string | null
          id: string
          metadata: Json
          notes: string | null
          paid_at: string | null
          payment_method: string
          payment_ref: string | null
          shipping_address: Json | null
          shipping_cost_cents: number
          shipping_method: string | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents: number
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_order_paid_by_gateway: {
        Args: {
          _amount_cents: number
          _external_id: string
          _order_id: string
          _payload?: Json
          _provider: string
        }
        Returns: string
      }
      mark_payment_failed: {
        Args: {
          _error: string
          _external_id: string
          _order_id: string
          _payload?: Json
          _provider: string
        }
        Returns: undefined
      }
      measure_decision_outcomes: {
        Args: { _limit?: number; _tenant: string }
        Returns: number
      }
      measure_outcomes_all_tenants: { Args: never; Returns: Json }
      measure_pending_outcomes: {
        Args: never
        Returns: {
          measured_count: number
          success_count: number
        }[]
      }
      notify_owner_telegram: {
        Args: { _kind: string; _source_id: string; _tenant_id: string }
        Returns: undefined
      }
      owner_approve_decision: { Args: { _decision_id: string }; Returns: Json }
      owner_change_plan: {
        Args: { _plan_key: string; _reason?: string; _tenant_id: string }
        Returns: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          notes: string | null
          overrides: Json
          plan_id: string
          status: string
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      owner_reject_decision: {
        Args: { _decision_id: string; _reason?: string }
        Returns: Json
      }
      owner_topup_ai_credits: {
        Args: { _amount: number; _reason?: string; _tenant_id: string }
        Returns: number
      }
      place_storefront_order:
        | {
            Args: {
              _customer_email: string
              _customer_name: string
              _items: Json
              _payment_method?: string
              _tenant_id: string
            }
            Returns: string
          }
        | {
            Args: {
              _customer_email: string
              _customer_name: string
              _items: Json
              _payment_method?: string
              _shipping?: Json
              _tenant_id: string
            }
            Returns: string
          }
        | {
            Args: {
              _customer_email: string
              _customer_name: string
              _items: Json
              _loyalty_redeem_points?: number
              _payment_method?: string
              _promo_code?: string
              _shipping?: Json
              _tenant_id: string
            }
            Returns: string
          }
      reconcile_dispatched_ai_actions: { Args: never; Returns: Json }
      refresh_all_signal_metrics: { Args: never; Returns: Json }
      refresh_customer_metrics_30d: {
        Args: { _tenant: string }
        Returns: number
      }
      refresh_funnel_metrics_14d: { Args: { _tenant: string }; Returns: number }
      refresh_product_metrics_14d: {
        Args: { _tenant: string }
        Returns: number
      }
      reject_decisions: {
        Args: { _ids: string[]; _reason?: string }
        Returns: Json
      }
      retry_failed_telegram_outbox: {
        Args: never
        Returns: {
          dropped: number
          requeued: number
        }[]
      }
      run_pending_ai_actions: { Args: { _limit?: number }; Returns: Json }
      run_sql_loop_tick: { Args: never; Returns: Json }
      self_heal_dismiss_action: {
        Args: { p_action_id: string; p_reason?: string }
        Returns: undefined
      }
      self_heal_dismiss_incident: {
        Args: { p_incident_id: string; p_reason?: string }
        Returns: undefined
      }
      set_owner_telegram_chat: {
        Args: { _chat_id: string; _tenant_id: string }
        Returns: undefined
      }
      simulate_lift_for_recent_decisions: {
        Args: { _tenant_id: string }
        Returns: {
          decisions_lifted: number
          orders_created: number
          revenue_cents: number
        }[]
      }
      simulate_pilot_orders: {
        Args: { _days?: number; _tenant_id: string }
        Returns: {
          items_created: number
          orders_created: number
          revenue_cents: number
        }[]
      }
      simulate_pilot_orders_with_lift: {
        Args: {
          _days_back?: number
          _lift_window_days?: number
          _tenant_id: string
        }
        Returns: {
          baseline_revenue_cents: number
          items_created: number
          lift_revenue_cents: number
          orders_created: number
          revenue_cents: number
        }[]
      }
      subscribe_restock_notification: {
        Args: {
          _email: string
          _product_id: string
          _tenant_id: string
          _variant_id: string
        }
        Returns: Json
      }
      tg_user_count_actions: {
        Args: {
          _action_type: string
          _tenant_id: string
          _window_minutes: number
        }
        Returns: number
      }
      touch_tenant_api_key: { Args: { _key_id: string }; Returns: undefined }
      unstick_executing_decisions: { Args: never; Returns: number }
      validate_discount_code: {
        Args: {
          _code: string
          _customer_email: string
          _order_total_cents: number
          _slug: string
        }
        Returns: Json
      }
      validate_loyalty_redeem: {
        Args: {
          _customer_email: string
          _order_total_cents: number
          _redeem_points: number
          _tenant_id: string
        }
        Returns: Json
      }
      validate_promo_code: {
        Args: { _code: string; _tenant_id: string }
        Returns: Json
      }
      validate_tenant_api_key: {
        Args: { _hash: string; _prefix: string }
        Returns: {
          key_id: string
          scopes: string[]
          tenant_id: string
          tier: string
        }[]
      }
    }
    Enums: {
      agent_mode: "off" | "suggest" | "auto"
      agent_risk_level: "low" | "medium" | "high"
      app_role: "super_admin"
      decision_status:
        | "pending"
        | "approved"
        | "executing"
        | "done"
        | "rejected"
        | "expired"
        | "failed"
      event_type:
        | "product_viewed"
        | "add_to_cart"
        | "checkout_started"
        | "purchase_completed"
        | "reorder_clicked"
        | "bot_interaction"
        | "content_viewed"
        | "inactivity_detected"
        | "message_sent"
        | "message_received"
        | "session_start"
        | "reorder_triggered"
        | "page_viewed"
        | "product_clicked"
        | "remove_from_cart"
        | "cart_viewed"
        | "begin_checkout"
        | "checkout_clicked"
        | "checkout_viewed"
        | "checkout_abandoned"
        | "checkout_failed"
        | "offer_shown"
        | "offer_skipped"
        | "upsell_accepted"
        | "upsell_dismissed"
        | "exit_intent_shown"
        | "exit_intent_dismissed"
        | "exit_intent_converted"
        | "bot_started"
        | "search_performed"
        | "wishlist_added"
        | "wishlist_removed"
        | "review_submitted"
        | "promo_applied"
        | "promo_failed"
        | "share_clicked"
        | "phone_call_clicked"
        | "telegram_link_clicked"
        | "chat_opened"
        | "chat_message_sent"
        | "newsletter_signup"
        | "ai_chat_product_click"
        | "ai_chat_product_recommended"
        | "reorder_completed"
        | "app_opened"
        | "deep_link_opened"
        | "push_received"
        | "push_opened"
        | "oauth_callback_success"
        | "apk_install_prompt_shown"
        | "apk_install_prompt_clicked"
        | "apk_install_prompt_dismissed"
        | "bot_reorder_reminder_sent"
        | "referral_link_copied"
        | "referral_link_shared"
        | "referral_clicked"
        | "referral_rewarded"
      order_status: "pending" | "paid" | "fulfilled" | "cancelled" | "refunded"
      tenant_role: "owner" | "admin" | "member"
      tenant_status: "active" | "suspended" | "archived" | "pending"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agent_mode: ["off", "suggest", "auto"],
      agent_risk_level: ["low", "medium", "high"],
      app_role: ["super_admin"],
      decision_status: [
        "pending",
        "approved",
        "executing",
        "done",
        "rejected",
        "expired",
        "failed",
      ],
      event_type: [
        "product_viewed",
        "add_to_cart",
        "checkout_started",
        "purchase_completed",
        "reorder_clicked",
        "bot_interaction",
        "content_viewed",
        "inactivity_detected",
        "message_sent",
        "message_received",
        "session_start",
        "reorder_triggered",
        "page_viewed",
        "product_clicked",
        "remove_from_cart",
        "cart_viewed",
        "begin_checkout",
        "checkout_clicked",
        "checkout_viewed",
        "checkout_abandoned",
        "checkout_failed",
        "offer_shown",
        "offer_skipped",
        "upsell_accepted",
        "upsell_dismissed",
        "exit_intent_shown",
        "exit_intent_dismissed",
        "exit_intent_converted",
        "bot_started",
        "search_performed",
        "wishlist_added",
        "wishlist_removed",
        "review_submitted",
        "promo_applied",
        "promo_failed",
        "share_clicked",
        "phone_call_clicked",
        "telegram_link_clicked",
        "chat_opened",
        "chat_message_sent",
        "newsletter_signup",
        "ai_chat_product_click",
        "ai_chat_product_recommended",
        "reorder_completed",
        "app_opened",
        "deep_link_opened",
        "push_received",
        "push_opened",
        "oauth_callback_success",
        "apk_install_prompt_shown",
        "apk_install_prompt_clicked",
        "apk_install_prompt_dismissed",
        "bot_reorder_reminder_sent",
        "referral_link_copied",
        "referral_link_shared",
        "referral_clicked",
        "referral_rewarded",
      ],
      order_status: ["pending", "paid", "fulfilled", "cancelled", "refunded"],
      tenant_role: ["owner", "admin", "member"],
      tenant_status: ["active", "suspended", "archived", "pending"],
    },
  },
} as const

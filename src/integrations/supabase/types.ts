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
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
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
            referencedRelation: "tenants"
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
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "tenants"
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
          id: string
          metadata: Json
          paid_at: string | null
          payment_method: string
          payment_ref: string | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_user_id?: string | null
          id?: string
          metadata?: Json
          paid_at?: string | null
          payment_method?: string
          payment_ref?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_user_id?: string | null
          id?: string
          metadata?: Json
          paid_at?: string | null
          payment_method?: string
          payment_ref?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
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
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_telegram_outbox: {
        Row: {
          chat_id: string | null
          created_at: string
          error: string | null
          id: string
          payload: Json
          sent_at: string | null
          source_id: string
          source_kind: string
          status: string
          tenant_id: string
          tg_message_id: number | null
        }
        Insert: {
          chat_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          sent_at?: string | null
          source_id: string
          source_kind: string
          status?: string
          tenant_id: string
          tg_message_id?: number | null
        }
        Update: {
          chat_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
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
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          metadata: Json
          name: string
          price_cents: number
          sku: string | null
          stock: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          metadata?: Json
          name: string
          price_cents?: number
          sku?: string | null
          stock?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          metadata?: Json
          name?: string
          price_cents?: number
          sku?: string | null
          stock?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
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
          name: string
          promo_type: string
          revenue_cents: number
          starts_at: string
          tenant_id: string
          times_used: number
          updated_at: string
          usage_limit: number | null
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
          name: string
          promo_type?: string
          revenue_cents?: number
          starts_at?: string
          tenant_id: string
          times_used?: number
          updated_at?: string
          usage_limit?: number | null
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
          name?: string
          promo_type?: string
          revenue_cents?: number
          starts_at?: string
          tenant_id?: string
          times_used?: number
          updated_at?: string
          usage_limit?: number | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "promotions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Relationships: []
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
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      [_ in never]: never
    }
    Functions: {
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
      admin_grant_super_admin: {
        Args: { _target_user_id: string }
        Returns: undefined
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
      admin_revoke_super_admin: {
        Args: { _target_user_id: string }
        Returns: undefined
      }
      cancel_order: {
        Args: { _order_id: string }
        Returns: {
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          customer_user_id: string | null
          id: string
          metadata: Json
          paid_at: string | null
          payment_method: string
          payment_ref: string | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents: number
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
      create_tenant_invitation: {
        Args: { _email: string; _role?: string; _tenant_id: string }
        Returns: Json
      }
      dntrade_partial_count_recent: {
        Args: { _hours?: number; _tenant_id: string }
        Returns: number
      }
      dntrade_unhealthy_streak_minutes: {
        Args: { _tenant_id: string }
        Returns: number
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
      get_public_order: { Args: { _order_id: string }; Returns: Json }
      get_storefront_config: { Args: { _slug: string }; Returns: Json }
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
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: { _tenant_id: string }; Returns: boolean }
      is_tenant_member: { Args: { _tenant_id: string }; Returns: boolean }
      mark_order_paid: {
        Args: { _order_id: string; _payment_ref?: string }
        Returns: {
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          customer_user_id: string | null
          id: string
          metadata: Json
          paid_at: string | null
          payment_method: string
          payment_ref: string | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notify_owner_telegram: {
        Args: { _kind: string; _source_id: string; _tenant_id: string }
        Returns: undefined
      }
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
      owner_topup_ai_credits: {
        Args: { _amount: number; _reason?: string; _tenant_id: string }
        Returns: number
      }
      place_storefront_order: {
        Args: {
          _customer_email: string
          _customer_name: string
          _items: Json
          _payment_method?: string
          _tenant_id: string
        }
        Returns: string
      }
      set_owner_telegram_chat: {
        Args: { _chat_id: string; _tenant_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "super_admin"
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
      tenant_status: "active" | "suspended" | "archived"
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
      app_role: ["super_admin"],
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
      tenant_status: ["active", "suspended", "archived"],
    },
  },
} as const

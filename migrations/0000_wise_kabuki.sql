CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_state" AS ENUM('created', 'availability_requested', 'availability_collected', 'schedule_generated', 'schedule_sent_for_review', 'schedule_confirmed', 'conflicts_resolved', 'finalized', 'processed');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"action" varchar NOT NULL,
	"target_type" varchar NOT NULL,
	"target_id" varchar,
	"details" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_chat_conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"context" jsonb,
	"last_message_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar NOT NULL,
	"role" varchar NOT NULL,
	"content" text NOT NULL,
	"sop_references" text[],
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_feedback" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar NOT NULL,
	"message_index" integer NOT NULL,
	"helpful" boolean NOT NULL,
	"feedback_text" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar NOT NULL,
	"user_id" varchar,
	"title" varchar NOT NULL,
	"description" text,
	"severity" varchar DEFAULT 'info',
	"is_read" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_scheduling_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_blocks" jsonb DEFAULT '[]'::jsonb,
	"staffing_tiers" jsonb DEFAULT '[]'::jsonb,
	"minimum_staffing" integer DEFAULT 2,
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now(),
	"store_hours" jsonb DEFAULT '[]'::jsonb,
	"shift_overlap_minutes" integer DEFAULT 60,
	"overlap_budget_limit" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "background_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"insight_type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"headline" text NOT NULL,
	"detail" text NOT NULL,
	"recommendation" text NOT NULL,
	"data_payload" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"acknowledged_by" text,
	"acted_on_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cash_deposits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"deposit_date" text NOT NULL,
	"deposited_by" varchar,
	"deposited_at" timestamp with time zone,
	"expected_amount" numeric(10, 2),
	"actual_amount" numeric(10, 2),
	"deposit_slip_photo" text,
	"register_summary_photo" text,
	"drawer_summary_photo" text,
	"ai_extracted_amount" numeric(10, 2),
	"ai_confidence" text,
	"ai_analysis" text,
	"discrepancy_amount" numeric(10, 2),
	"discrepancy_explanation" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" varchar,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cash_discrepancy_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"drawer_session_id" varchar,
	"session_date" text NOT NULL,
	"register_name" text NOT NULL,
	"session_type" text NOT NULL,
	"counted_by" varchar,
	"amount" numeric(10, 2) NOT NULL,
	"explanation" text,
	"employees_on_duty" jsonb,
	"opened_by" varchar,
	"previous_closed_by" varchar,
	"ai_flags" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cash_management_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"default_starting_cash" numeric(10, 2) DEFAULT '200.00',
	"registers" jsonb,
	"over_short_threshold" numeric(10, 2) DEFAULT '5.00',
	"require_deposit_photo" boolean DEFAULT true,
	"require_over_short_explanation" boolean DEFAULT true,
	"auto_flag_threshold" numeric(10, 2) DEFAULT '20.00',
	"closing_time" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cash_management_settings_store_id_unique" UNIQUE("store_id")
);
--> statement-breakpoint
CREATE TABLE "chat_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"description" text,
	"created_by" varchar NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clock_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"time_entry_id" varchar,
	"event_type" varchar NOT NULL,
	"point_value" integer DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "commute_alerts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"type" varchar NOT NULL,
	"title" varchar NOT NULL,
	"message" text NOT NULL,
	"severity" varchar DEFAULT 'info',
	"is_read" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" varchar DEFAULT 'My Company',
	"timezone" varchar DEFAULT 'America/New_York',
	"business_start_hour" integer DEFAULT 8,
	"business_end_hour" integer DEFAULT 17,
	"overtime_threshold_hours" integer DEFAULT 40,
	"overtime_multiplier" numeric(3, 2) DEFAULT '1.50',
	"geofence_enforcement" boolean DEFAULT false,
	"break_duration_minutes" integer DEFAULT 30,
	"auto_clock_out_minutes" integer DEFAULT 480,
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now(),
	"location_phone" varchar,
	"address_1" varchar,
	"address_2" varchar,
	"city" varchar,
	"state_province" varchar,
	"zip_code" varchar,
	"country" varchar DEFAULT 'United States',
	"business_type" varchar,
	"business_category" varchar,
	"website" varchar,
	"account_owner_name" varchar,
	"company_phone" varchar,
	"work_week_start" varchar DEFAULT 'sunday',
	"scheduling_start_time" varchar DEFAULT '09:00',
	"scheduling_end_time" varchar DEFAULT '17:00',
	"late_threshold_minutes" integer DEFAULT 5,
	"prevent_early_clock_in" boolean DEFAULT false,
	"early_clock_in_minutes" integer DEFAULT 5,
	"prevent_early_break_return" boolean DEFAULT false,
	"single_clock_out_reminder" boolean DEFAULT true,
	"auto_clock_out_enabled" boolean DEFAULT false,
	"auto_clock_out_after_minutes" text,
	"text_schedule_to_employees" boolean DEFAULT false,
	"employees_view_own_schedule_only" boolean DEFAULT false,
	"notify_manager_late_clock_in" boolean DEFAULT true,
	"manager_late_alert_minutes" integer DEFAULT 19,
	"require_manager_approval_availability" boolean DEFAULT true,
	"managers_schedule_own_dept" boolean DEFAULT false,
	"request_shift_experience" boolean DEFAULT true,
	"require_cash_tip_declaration" boolean DEFAULT false,
	"enable_clock_rounding" boolean DEFAULT false,
	"rounding_increment" integer DEFAULT 5,
	"enable_mobile_time_clock" boolean DEFAULT true,
	"allow_unscheduled_mobile_clock_in" boolean DEFAULT false,
	"enable_web_time_clock" boolean DEFAULT false,
	"allow_employee_web_clock" boolean DEFAULT false,
	"unscheduled_shift_role_selection" boolean DEFAULT false,
	"enable_daily_overtime" boolean DEFAULT false,
	"daily_overtime_hours" integer DEFAULT 8,
	"daily_overtime_multiplier" numeric(3, 2) DEFAULT '1.50',
	"enable_weekly_overtime" boolean DEFAULT true,
	"overtime_alert_enabled" boolean DEFAULT false,
	"overtime_alert_hours" integer DEFAULT 40,
	"start_of_workday" varchar DEFAULT '00:00',
	"track_overtime_across_locations" boolean DEFAULT false,
	"enable_holiday_pay_rate" boolean DEFAULT false,
	"holiday_pay_multiplier" numeric(3, 2) DEFAULT '1.50',
	"break_rule_1_enabled" boolean DEFAULT true,
	"break_rule_1_minutes" integer DEFAULT 10,
	"break_rule_1_type" varchar DEFAULT 'paid',
	"break_rule_1_every_hours" integer DEFAULT 4,
	"break_rule_1_required" varchar DEFAULT 'optional',
	"break_rule_2_enabled" boolean DEFAULT true,
	"break_rule_2_minutes" integer DEFAULT 30,
	"break_rule_2_type" varchar DEFAULT 'unpaid',
	"break_rule_2_every_hours" integer DEFAULT 6,
	"break_rule_2_required" varchar DEFAULT 'optional',
	"subtract_unpaid_breaks" boolean DEFAULT true,
	"convert_excess_to_unpaid" boolean DEFAULT false,
	"award_missed_break_hours" boolean DEFAULT false,
	"missed_break_award_hours" integer DEFAULT 1,
	"missed_break_policy" varchar DEFAULT 'managers_only',
	"pay_schedule_frequency" varchar DEFAULT 'every_two_weeks',
	"next_payroll_date" varchar,
	"lock_timesheets_after_approval" boolean DEFAULT false,
	"time_off_max_per_day" integer,
	"time_off_advance_days" integer DEFAULT 0,
	"limit_time_off_requests" boolean DEFAULT false,
	"limit_time_off_advance" boolean DEFAULT false,
	"allow_shout_outs" boolean DEFAULT true,
	"allow_team_messaging" boolean DEFAULT true,
	"enable_schedule_events" boolean DEFAULT true,
	"default_geofence_radius" integer DEFAULT 100,
	"enable_smart_clock_prompt" boolean DEFAULT false,
	"enable_clock_out_on_focus_loss" boolean DEFAULT false,
	"focus_loss_grace_seconds" integer DEFAULT 30,
	"auto_resume_window_seconds" integer DEFAULT 120,
	"require_mobile_clock_in" boolean DEFAULT false,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_debriefs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar NOT NULL,
	"employee_id" varchar NOT NULL,
	"debrief_date" date NOT NULL,
	"what_went_well" text,
	"what_bugged_you" text,
	"what_bugged_you_category" text,
	"what_bugged_you_photo_url" text,
	"customer_highlights" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "daily_quote_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar NOT NULL,
	"quote_text_hash" text NOT NULL,
	"used_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "daily_quotes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar NOT NULL,
	"quote_date" date NOT NULL,
	"quote_text" text NOT NULL,
	"quote_author" text NOT NULL,
	"generated_by_ai" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "drawer_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"session_date" text NOT NULL,
	"session_type" text NOT NULL,
	"register_name" text NOT NULL,
	"register_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"counted_by" varchar,
	"counted_at" timestamp with time zone,
	"verified_by" varchar,
	"verified_at" timestamp with time zone,
	"starting_cash" numeric(10, 2) DEFAULT '200.00',
	"hundred_count" integer,
	"fifty_count" integer,
	"twenty_count" integer,
	"ten_count" integer,
	"five_count" integer,
	"one_count" integer,
	"rolled_quarter_count" integer,
	"rolled_dime_count" integer,
	"rolled_nickel_count" integer,
	"rolled_penny_count" integer,
	"penny_count" integer,
	"nickel_count" integer,
	"dime_count" integer,
	"quarter_count" integer,
	"total_cash_counted" numeric(10, 2),
	"expected_cash" numeric(10, 2),
	"over_short_amount" numeric(10, 2),
	"over_short_explanation" text,
	"register_cash_sales" numeric(10, 2),
	"register_total_sales" numeric(10, 2),
	"register_shopify_payments" numeric(10, 2),
	"recount_attempts" integer DEFAULT 0,
	"recount_history" jsonb,
	"employees_on_duty" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"category" varchar NOT NULL,
	"name" varchar NOT NULL,
	"file_name" varchar NOT NULL,
	"file_data" text NOT NULL,
	"file_type" varchar,
	"file_size" integer,
	"uploaded_by" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employee_training_progress" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"module_id" varchar NOT NULL,
	"status" varchar DEFAULT 'not_started' NOT NULL,
	"completed_at" timestamp,
	"score" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gamification_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar,
	"tier_thresholds" jsonb DEFAULT '{"bronze":0,"silver":40,"gold":60,"platinum":80,"diamond":95}'::jsonb,
	"prize_descriptions" jsonb DEFAULT '{"gold":"Free lunch this month!","platinum":"Gift card reward","diamond":"Employee of the month recognition"}'::jsonb,
	"category_weights" jsonb DEFAULT '{"attendance":30,"tasks":30,"sops":20,"engagement":20}'::jsonb,
	"score_notifications_enabled" boolean DEFAULT true,
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "geofence_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"location_id" varchar NOT NULL,
	"event_type" varchar(20) NOT NULL,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"distance_from_center" numeric(10, 2),
	"time_entry_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"joined_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gtd_inbox_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"captured_by" text NOT NULL,
	"raw_input" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'unprocessed' NOT NULL,
	"ai_clarification" jsonb,
	"processed_at" timestamp with time zone,
	"processed_into_type" text,
	"processed_into_id" varchar,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gtd_next_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"project_id" varchar,
	"assigned_to" text NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"context" text,
	"energy_level" text,
	"time_estimate_minutes" integer,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"is_two_minute" boolean DEFAULT false,
	"source_inbox_item_id" varchar,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gtd_projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"desired_outcome" text,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gtd_reference" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"source_inbox_item_id" varchar,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gtd_someday_maybe" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"status" text DEFAULT 'parked' NOT NULL,
	"activated_into_type" text,
	"activated_into_id" varchar,
	"source_inbox_item_id" varchar,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gtd_waiting_for" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"project_id" varchar,
	"owner_id" text NOT NULL,
	"waiting_on" text NOT NULL,
	"waiting_on_employee_id" text,
	"description" text NOT NULL,
	"follow_up_date" date,
	"status" text DEFAULT 'waiting' NOT NULL,
	"received_at" timestamp with time zone,
	"source_inbox_item_id" varchar,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "holiday_pay_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"month" integer NOT NULL,
	"day" integer NOT NULL,
	"pay_multiplier" numeric(3, 2) DEFAULT '1.50',
	"is_active" boolean DEFAULT true,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "improvement_videos" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"storage_type" text NOT NULL,
	"youtube_video_id" text,
	"s3_key" text,
	"s3_url" text,
	"thumbnail_url" text,
	"duration_seconds" integer,
	"status" text DEFAULT 'processing' NOT NULL,
	"is_featured" boolean DEFAULT false,
	"view_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "issue_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" varchar NOT NULL,
	"author_id" varchar NOT NULL,
	"comment_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar NOT NULL,
	"reported_by" varchar NOT NULL,
	"assigned_to" varchar,
	"title" text NOT NULL,
	"description" text,
	"category" varchar NOT NULL,
	"priority" varchar DEFAULT 'medium' NOT NULL,
	"status" varchar DEFAULT 'open' NOT NULL,
	"photo_url" text,
	"resolution_notes" text,
	"related_sop_id" varchar,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kudos" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar NOT NULL,
	"from_employee_id" varchar NOT NULL,
	"to_employee_id" varchar NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lean_board_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"metrics" jsonb NOT NULL,
	"ai_summary" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "manager_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"manager_id" varchar NOT NULL,
	"note" text NOT NULL,
	"category" varchar NOT NULL,
	"is_private" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meeting_recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" varchar NOT NULL,
	"description" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assignee_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"gtd_inbox_item_id" varchar,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"created_by" text NOT NULL,
	"title" varchar(500) NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb,
	"duration_seconds" integer,
	"status" text DEFAULT 'processing' NOT NULL,
	"transcript" text,
	"synopsis" text,
	"audio_path" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"thread_type" text NOT NULL,
	"title" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" varchar NOT NULL,
	"recipient_id" varchar,
	"group_id" varchar,
	"content" text NOT NULL,
	"is_announcement" boolean DEFAULT false,
	"read_by" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "midday_pulses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar NOT NULL,
	"pulse_date" date NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "morning_huddles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar NOT NULL,
	"huddle_date" date NOT NULL,
	"led_by" varchar,
	"attendees" jsonb DEFAULT '[]'::jsonb,
	"win_of_the_day" text,
	"lean_principle" text,
	"goals" jsonb DEFAULT '[]'::jsonb,
	"heads_up" jsonb DEFAULT '[]'::jsonb,
	"kudos_surfaced" jsonb DEFAULT '[]'::jsonb,
	"ai_generated_content" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "morning_whispers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"user_id" text NOT NULL,
	"whisper_date" date NOT NULL,
	"content" jsonb NOT NULL,
	"listened" boolean DEFAULT false,
	"listened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "offsite_allowance_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"allowed_minutes" integer DEFAULT 30 NOT NULL,
	"allowed_time_start" varchar,
	"allowed_time_end" varchar,
	"applies_to" varchar DEFAULT 'all' NOT NULL,
	"specific_employee_ids" jsonb,
	"alert_after_minutes" integer DEFAULT 20,
	"alert_recipients" varchar DEFAULT 'both' NOT NULL,
	"custom_alert_user_ids" jsonb,
	"is_active" boolean DEFAULT true,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "offsite_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"time_entry_id" varchar,
	"user_id" varchar NOT NULL,
	"location_id" varchar NOT NULL,
	"rule_id" varchar,
	"exit_time" timestamp NOT NULL,
	"return_time" timestamp,
	"duration_minutes" integer,
	"was_alert_sent" boolean DEFAULT false,
	"alert_sent_at" timestamp,
	"status" varchar DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overtime_alerts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"current_hours" numeric(6, 2) NOT NULL,
	"projected_hours" numeric(6, 2) NOT NULL,
	"threshold" numeric(6, 2) DEFAULT '40.00' NOT NULL,
	"at_risk_shift_id" varchar,
	"suggested_replacement_id" varchar,
	"ai_reasoning" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"applied_at" timestamp,
	"applied_by" varchar,
	"dismissed_at" timestamp,
	"dismissed_by" varchar,
	"week_start_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pay_period_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interval_type" varchar DEFAULT 'bi-weekly',
	"is_automation_enabled" boolean DEFAULT false,
	"days_before_notification" integer DEFAULT 7,
	"schedule_generation_days" integer DEFAULT 5,
	"automatic_conflict_resolution" boolean DEFAULT true,
	"first_pay_period_start" timestamp,
	"first_pay_period_end" timestamp,
	"pay_day_of_week" integer DEFAULT 5,
	"notification_user_id" varchar,
	"is_setup_complete" boolean DEFAULT false,
	"created_by" varchar,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"workflow_state" "workflow_state" DEFAULT 'created',
	"is_processed" boolean DEFAULT false,
	"processed_by" varchar,
	"processed_at" timestamp,
	"ai_analysis" jsonb,
	"availability_deadline" timestamp,
	"schedule_confirmation_deadline" timestamp,
	"availability_notification_sent_at" timestamp,
	"schedule_generated_at" timestamp,
	"schedule_sent_at" timestamp,
	"schedule_confirmed_at" timestamp,
	"finalized_at" timestamp,
	"automation_metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "performance_score_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar NOT NULL,
	"category" varchar NOT NULL,
	"display_name" varchar NOT NULL,
	"point_value" integer NOT NULL,
	"is_active" boolean DEFAULT true,
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "performance_score_settings_event_type_unique" UNIQUE("event_type")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"display_name" varchar NOT NULL,
	"description" text,
	"category" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "permissions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" varchar NOT NULL,
	"permission_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"display_name" varchar NOT NULL,
	"description" text,
	"is_system_role" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "schedule_confirmations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"is_confirmed" boolean DEFAULT false,
	"feedback" text,
	"conflicts" jsonb,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"location_id" varchar,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"title" varchar,
	"description" text,
	"is_recurring" boolean DEFAULT false,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "score_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"snapshot_date" date NOT NULL,
	"overall_score" integer DEFAULT 0 NOT NULL,
	"attendance_score" integer DEFAULT 0 NOT NULL,
	"task_score" integer DEFAULT 0 NOT NULL,
	"sop_score" integer DEFAULT 0 NOT NULL,
	"engagement_score" integer DEFAULT 0 NOT NULL,
	"tier" varchar DEFAULT 'bronze' NOT NULL,
	"rank" integer,
	"total_points" integer DEFAULT 0,
	"streak_days" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "score_notices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"category" varchar NOT NULL,
	"severity" varchar DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_daily_sales" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_domain" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"day_of_week" integer,
	"order_count" integer DEFAULT 0,
	"total_revenue" numeric(12, 2) DEFAULT '0.00',
	"item_count" integer DEFAULT 0,
	"average_order_value" numeric(10, 2) DEFAULT '0.00',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shopify_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_domain" varchar NOT NULL,
	"order_id" varchar NOT NULL,
	"order_number" varchar,
	"email" varchar,
	"total_price" numeric(12, 2),
	"currency" varchar,
	"financial_status" varchar,
	"fulfillment_status" varchar,
	"line_items" jsonb,
	"customer_data" jsonb,
	"order_created_at" timestamp,
	"processed_at" timestamp,
	"synced_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_domain" varchar NOT NULL,
	"shop_name" varchar,
	"shop_email" varchar,
	"access_token" varchar,
	"scope" varchar,
	"currency" varchar DEFAULT 'USD',
	"timezone" varchar,
	"is_active" boolean DEFAULT true,
	"last_sync_at" timestamp,
	"installed_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "shops_shop_domain_unique" UNIQUE("shop_domain")
);
--> statement-breakpoint
CREATE TABLE "shoutouts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" varchar NOT NULL,
	"recipient_id" varchar NOT NULL,
	"category" varchar NOT NULL,
	"message" text NOT NULL,
	"emoji" varchar,
	"reactions" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sop_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"description" text,
	"icon" varchar,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sop_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"is_published" boolean DEFAULT false,
	"version" integer DEFAULT 1,
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sop_embeddings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" varchar NOT NULL,
	"content_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sop_executions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" varchar NOT NULL,
	"employee_id" text NOT NULL,
	"store_id" varchar NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"branch_path" jsonb DEFAULT '[]'::jsonb,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sop_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"insight_type" text NOT NULL,
	"severity" text NOT NULL,
	"sop_template_id" varchar,
	"step_id" varchar,
	"headline" text NOT NULL,
	"detail" text NOT NULL,
	"recommendation" text NOT NULL,
	"data_point" text,
	"status" text DEFAULT 'active' NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sop_revision_proposals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"sop_template_id" varchar NOT NULL,
	"source_type" text NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb,
	"proposal_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"ai_rationale" text,
	"proposed_changes" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sop_step_completions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" varchar NOT NULL,
	"step_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"time_spent_seconds" integer,
	"skip_reason" text,
	"photo_url" text,
	"notes" text,
	"manager_sign_off" boolean DEFAULT false,
	"manager_sign_off_by" text,
	"manager_sign_off_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sop_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" varchar NOT NULL,
	"step_order" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"step_type" text NOT NULL,
	"is_checkpoint" boolean DEFAULT false,
	"timer_duration_seconds" integer,
	"decision_options" jsonb,
	"training_detail" text,
	"training_video_url" text,
	"training_photo_urls" jsonb DEFAULT '[]'::jsonb,
	"training_video_thumbnail" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sop_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"estimated_duration_minutes" integer,
	"role_assignments" jsonb,
	"is_active" boolean DEFAULT true,
	"training_notes" text,
	"walkthrough_video_url" text,
	"is_training_priority" boolean DEFAULT false,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_template_id" varchar,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"assigned_to" varchar,
	"created_by" varchar NOT NULL,
	"location_id" varchar,
	"due_date" timestamp,
	"estimated_minutes" integer,
	"status" "task_status" DEFAULT 'pending',
	"is_ai_assigned" boolean DEFAULT false,
	"ai_reasoning" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"day_of_week" varchar,
	"time_of_day" varchar,
	"is_recurring" boolean DEFAULT false,
	"requires_signature" boolean DEFAULT false,
	"employee_signed_at" timestamp,
	"manager_signed_at" timestamp,
	"signed_by" varchar,
	"verified_by" varchar,
	"chore_zone" varchar,
	"priority" varchar DEFAULT 'medium',
	"completion_image_url" text
);
--> statement-breakpoint
CREATE TABLE "thread_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" varchar NOT NULL,
	"sender_id" text NOT NULL,
	"content" text NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"image_url" text,
	"reply_to_id" varchar,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "thread_participants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" varchar NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_thread_participant" UNIQUE("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"location_id" varchar,
	"clock_in_time" timestamp NOT NULL,
	"clock_out_time" timestamp,
	"break_minutes" integer DEFAULT 0,
	"notes" text,
	"clock_in_source" varchar DEFAULT 'shift-start',
	"clock_out_source" varchar DEFAULT 'shift-end',
	"is_approved" boolean DEFAULT false,
	"approved_by" varchar,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "time_entry_edits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"time_entry_id" varchar NOT NULL,
	"edited_by" varchar NOT NULL,
	"edited_at" timestamp DEFAULT now(),
	"field_changed" varchar NOT NULL,
	"old_value" text,
	"new_value" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "time_off_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"type" varchar NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"all_day" boolean DEFAULT true,
	"start_time" varchar,
	"end_time" varchar,
	"reason" text,
	"admin_notes" text,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "training_modules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"category" varchar,
	"estimated_minutes" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"achievement_key" varchar NOT NULL,
	"achievement_name" varchar NOT NULL,
	"achievement_description" varchar,
	"achievement_icon" varchar,
	"earned_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_availability" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"payroll_period_id" varchar,
	"date" timestamp NOT NULL,
	"time_slot" varchar NOT NULL,
	"is_available" boolean DEFAULT true,
	"start_time" varchar,
	"end_time" varchar,
	"notes" text,
	"submitted_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_shops" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"shop_domain" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_work_patterns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"template_id" varchar,
	"custom_pattern" jsonb,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"phone" varchar,
	"employment_type" varchar DEFAULT 'contractor',
	"role_id" varchar,
	"hourly_rate" numeric(10, 2),
	"location_name" varchar,
	"payroll_classification" varchar DEFAULT '1099 Contractor',
	"start_date" timestamp,
	"pin" varchar,
	"show_in_schedule" boolean DEFAULT true,
	"target_weekly_hours" numeric(5, 1),
	"send_location_alerts" boolean DEFAULT true,
	"include_in_time_clock_errors" boolean DEFAULT true,
	"eligible_for_open_shifts" boolean DEFAULT true,
	"can_waive_missed_breaks" boolean DEFAULT false,
	"home_latitude" numeric(10, 8),
	"home_longitude" numeric(11, 8),
	"legal_name" varchar,
	"date_of_birth" varchar,
	"ssn" varchar,
	"home_address" text,
	"home_city" varchar,
	"home_state" varchar,
	"home_zip" varchar,
	"emergency_contact_name" varchar,
	"emergency_contact_phone" varchar,
	"preferred_name" varchar,
	"personal_email" varchar,
	"score_notifications_enabled" boolean DEFAULT true,
	"invited_at" timestamp,
	"invite_accepted_at" timestamp,
	"invite_token" varchar,
	"invite_count" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE "video_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" varchar NOT NULL,
	"employee_id" text NOT NULL,
	"comment_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "video_likes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" varchar NOT NULL,
	"employee_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_video_likes_video_employee" UNIQUE("video_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "weekly_reviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"user_id" text NOT NULL,
	"review_week_start" date NOT NULL,
	"ai_content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"address" text,
	"phone" varchar,
	"email" varchar,
	"timezone" varchar,
	"hours_of_operation" jsonb,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"radius" integer DEFAULT 100,
	"wifi_ssid" varchar,
	"is_active" boolean DEFAULT true,
	"geofence_type" varchar(20) DEFAULT 'radius',
	"geofence_polygon" jsonb,
	"geofence_grace_minutes" text DEFAULT '5.00',
	"geofence_enabled" boolean DEFAULT true,
	"auto_clock_out" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_pattern_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"description" text,
	"pattern" jsonb NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" varchar NOT NULL,
	"workflow_step" varchar NOT NULL,
	"status" varchar NOT NULL,
	"details" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_conversations" ADD CONSTRAINT "ai_chat_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_conversation_id_ai_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_chat_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_conversation_id_ai_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_chat_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_scheduling_settings" ADD CONSTRAINT "ai_scheduling_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clock_events" ADD CONSTRAINT "clock_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clock_events" ADD CONSTRAINT "clock_events_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commute_alerts" ADD CONSTRAINT "commute_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_debriefs" ADD CONSTRAINT "daily_debriefs_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_quote_history" ADD CONSTRAINT "daily_quote_history_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_quotes" ADD CONSTRAINT "daily_quotes_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_training_progress" ADD CONSTRAINT "employee_training_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_training_progress" ADD CONSTRAINT "employee_training_progress_module_id_training_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."training_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gamification_settings" ADD CONSTRAINT "gamification_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_location_id_work_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_inbox_items" ADD CONSTRAINT "gtd_inbox_items_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_next_actions" ADD CONSTRAINT "gtd_next_actions_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_next_actions" ADD CONSTRAINT "gtd_next_actions_project_id_gtd_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."gtd_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_next_actions" ADD CONSTRAINT "gtd_next_actions_source_inbox_item_id_gtd_inbox_items_id_fk" FOREIGN KEY ("source_inbox_item_id") REFERENCES "public"."gtd_inbox_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_projects" ADD CONSTRAINT "gtd_projects_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_reference" ADD CONSTRAINT "gtd_reference_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_reference" ADD CONSTRAINT "gtd_reference_source_inbox_item_id_gtd_inbox_items_id_fk" FOREIGN KEY ("source_inbox_item_id") REFERENCES "public"."gtd_inbox_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_someday_maybe" ADD CONSTRAINT "gtd_someday_maybe_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_someday_maybe" ADD CONSTRAINT "gtd_someday_maybe_source_inbox_item_id_gtd_inbox_items_id_fk" FOREIGN KEY ("source_inbox_item_id") REFERENCES "public"."gtd_inbox_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_waiting_for" ADD CONSTRAINT "gtd_waiting_for_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_waiting_for" ADD CONSTRAINT "gtd_waiting_for_project_id_gtd_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."gtd_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtd_waiting_for" ADD CONSTRAINT "gtd_waiting_for_source_inbox_item_id_gtd_inbox_items_id_fk" FOREIGN KEY ("source_inbox_item_id") REFERENCES "public"."gtd_inbox_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_pay_rules" ADD CONSTRAINT "holiday_pay_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_related_sop_id_sop_templates_id_fk" FOREIGN KEY ("related_sop_id") REFERENCES "public"."sop_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_notes" ADD CONSTRAINT "manager_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_notes" ADD CONSTRAINT "manager_notes_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_recommendations" ADD CONSTRAINT "meeting_recommendations_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "midday_pulses" ADD CONSTRAINT "midday_pulses_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morning_huddles" ADD CONSTRAINT "morning_huddles_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offsite_allowance_rules" ADD CONSTRAINT "offsite_allowance_rules_location_id_work_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offsite_allowance_rules" ADD CONSTRAINT "offsite_allowance_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offsite_sessions" ADD CONSTRAINT "offsite_sessions_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offsite_sessions" ADD CONSTRAINT "offsite_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offsite_sessions" ADD CONSTRAINT "offsite_sessions_location_id_work_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offsite_sessions" ADD CONSTRAINT "offsite_sessions_rule_id_offsite_allowance_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."offsite_allowance_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_alerts" ADD CONSTRAINT "overtime_alerts_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_alerts" ADD CONSTRAINT "overtime_alerts_at_risk_shift_id_schedules_id_fk" FOREIGN KEY ("at_risk_shift_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_alerts" ADD CONSTRAINT "overtime_alerts_suggested_replacement_id_users_id_fk" FOREIGN KEY ("suggested_replacement_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_alerts" ADD CONSTRAINT "overtime_alerts_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_alerts" ADD CONSTRAINT "overtime_alerts_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_settings" ADD CONSTRAINT "pay_period_settings_notification_user_id_users_id_fk" FOREIGN KEY ("notification_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_settings" ADD CONSTRAINT "pay_period_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_settings" ADD CONSTRAINT "pay_period_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_score_settings" ADD CONSTRAINT "performance_score_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_confirmations" ADD CONSTRAINT "schedule_confirmations_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_confirmations" ADD CONSTRAINT "schedule_confirmations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_location_id_work_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_history" ADD CONSTRAINT "score_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_notices" ADD CONSTRAINT "score_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoutouts" ADD CONSTRAINT "shoutouts_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoutouts" ADD CONSTRAINT "shoutouts_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_documents" ADD CONSTRAINT "sop_documents_category_id_sop_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."sop_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_documents" ADD CONSTRAINT "sop_documents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_executions" ADD CONSTRAINT "sop_executions_template_id_sop_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sop_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_executions" ADD CONSTRAINT "sop_executions_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_insights" ADD CONSTRAINT "sop_insights_sop_template_id_sop_templates_id_fk" FOREIGN KEY ("sop_template_id") REFERENCES "public"."sop_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_revision_proposals" ADD CONSTRAINT "sop_revision_proposals_sop_template_id_sop_templates_id_fk" FOREIGN KEY ("sop_template_id") REFERENCES "public"."sop_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_step_completions" ADD CONSTRAINT "sop_step_completions_execution_id_sop_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."sop_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_step_completions" ADD CONSTRAINT "sop_step_completions_step_id_sop_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sop_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_template_id_sop_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sop_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_templates" ADD CONSTRAINT "sop_templates_store_id_work_locations_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_location_id_work_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_location_id_work_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_edits" ADD CONSTRAINT "time_entry_edits_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_edits" ADD CONSTRAINT "time_entry_edits_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_availability" ADD CONSTRAINT "user_availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_availability" ADD CONSTRAINT "user_availability_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_shops" ADD CONSTRAINT "user_shops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_shops" ADD CONSTRAINT "user_shops_shop_domain_shops_shop_domain_fk" FOREIGN KEY ("shop_domain") REFERENCES "public"."shops"("shop_domain") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_work_patterns" ADD CONSTRAINT "user_work_patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_work_patterns" ADD CONSTRAINT "user_work_patterns_template_id_work_pattern_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_pattern_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_logs" ADD CONSTRAINT "workflow_logs_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bg_insights_store_status_sev" ON "background_insights" USING btree ("store_id","status","severity","created_at");--> statement-breakpoint
CREATE INDEX "idx_bg_insights_store_type" ON "background_insights" USING btree ("store_id","insight_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_cash_deposits_store_date" ON "cash_deposits" USING btree ("store_id","deposit_date");--> statement-breakpoint
CREATE INDEX "idx_cash_deposits_store_status" ON "cash_deposits" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "idx_cash_discrepancy_store_date" ON "cash_discrepancy_log" USING btree ("store_id","session_date");--> statement-breakpoint
CREATE INDEX "idx_cash_discrepancy_counted_by" ON "cash_discrepancy_log" USING btree ("counted_by");--> statement-breakpoint
CREATE INDEX "idx_cash_discrepancy_store_created" ON "cash_discrepancy_log" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_clock_events_user_created" ON "clock_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_daily_debriefs_employee_date" ON "daily_debriefs" USING btree ("employee_id","debrief_date");--> statement-breakpoint
CREATE INDEX "idx_daily_debriefs_store_date" ON "daily_debriefs" USING btree ("store_id","debrief_date");--> statement-breakpoint
CREATE INDEX "idx_daily_debriefs_employee_date" ON "daily_debriefs" USING btree ("employee_id","debrief_date");--> statement-breakpoint
CREATE INDEX "idx_daily_debriefs_store_category_created" ON "daily_debriefs" USING btree ("store_id","what_bugged_you_category","created_at");--> statement-breakpoint
CREATE INDEX "idx_daily_quote_history_store_hash" ON "daily_quote_history" USING btree ("store_id","quote_text_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_daily_quotes_store_date" ON "daily_quotes" USING btree ("store_id","quote_date");--> statement-breakpoint
CREATE INDEX "idx_drawer_sessions_store_date" ON "drawer_sessions" USING btree ("store_id","session_date");--> statement-breakpoint
CREATE INDEX "idx_drawer_sessions_store_status" ON "drawer_sessions" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "idx_drawer_sessions_counted_by" ON "drawer_sessions" USING btree ("counted_by");--> statement-breakpoint
CREATE INDEX "idx_gtd_inbox_store_status_created" ON "gtd_inbox_items" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_gtd_inbox_captured_status" ON "gtd_inbox_items" USING btree ("captured_by","status");--> statement-breakpoint
CREATE INDEX "idx_gtd_actions_store_assigned_status" ON "gtd_next_actions" USING btree ("store_id","assigned_to","status");--> statement-breakpoint
CREATE INDEX "idx_gtd_actions_store_context_status" ON "gtd_next_actions" USING btree ("store_id","context","status");--> statement-breakpoint
CREATE INDEX "idx_gtd_actions_store_priority_status" ON "gtd_next_actions" USING btree ("store_id","priority","status");--> statement-breakpoint
CREATE INDEX "idx_gtd_actions_project_status" ON "gtd_next_actions" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "idx_gtd_actions_due_active" ON "gtd_next_actions" USING btree ("due_date") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "idx_gtd_projects_store_owner_status" ON "gtd_projects" USING btree ("store_id","owner_id","status");--> statement-breakpoint
CREATE INDEX "idx_gtd_reference_store_owner" ON "gtd_reference" USING btree ("store_id","owner_id");--> statement-breakpoint
CREATE INDEX "idx_gtd_someday_store_owner_status" ON "gtd_someday_maybe" USING btree ("store_id","owner_id","status");--> statement-breakpoint
CREATE INDEX "idx_gtd_waiting_store_owner_status" ON "gtd_waiting_for" USING btree ("store_id","owner_id","status");--> statement-breakpoint
CREATE INDEX "idx_gtd_waiting_followup_active" ON "gtd_waiting_for" USING btree ("follow_up_date") WHERE status = 'waiting';--> statement-breakpoint
CREATE INDEX "idx_improvement_videos_store_created" ON "improvement_videos" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_improvement_videos_store_status_cat" ON "improvement_videos" USING btree ("store_id","status","category");--> statement-breakpoint
CREATE INDEX "idx_improvement_videos_employee_created" ON "improvement_videos" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_improvement_videos_store_featured" ON "improvement_videos" USING btree ("store_id","is_featured");--> statement-breakpoint
CREATE INDEX "idx_issue_comments_issue_created" ON "issue_comments" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_issues_store_status_priority" ON "issues" USING btree ("store_id","status","priority");--> statement-breakpoint
CREATE INDEX "idx_issues_store_category_created" ON "issues" USING btree ("store_id","category","created_at");--> statement-breakpoint
CREATE INDEX "idx_issues_store_assigned_status" ON "issues" USING btree ("store_id","assigned_to","status");--> statement-breakpoint
CREATE INDEX "idx_issues_reported_created" ON "issues" USING btree ("reported_by","created_at");--> statement-breakpoint
CREATE INDEX "idx_kudos_store_created" ON "kudos" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_kudos_to_employee_created" ON "kudos" USING btree ("to_employee_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lean_board_store_date" ON "lean_board_snapshots" USING btree ("store_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_lean_board_store_date" ON "lean_board_snapshots" USING btree ("store_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_meeting_recs_meeting" ON "meeting_recommendations" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "idx_meetings_store_created" ON "meetings" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_meetings_status" ON "meetings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_message_threads_store_updated" ON "message_threads" USING btree ("store_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_messages_sender_recipient" ON "messages" USING btree ("sender_id","recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_midday_pulses_store_date" ON "midday_pulses" USING btree ("store_id","pulse_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_morning_huddles_store_date" ON "morning_huddles" USING btree ("store_id","huddle_date");--> statement-breakpoint
CREATE INDEX "idx_morning_huddles_store_date" ON "morning_huddles" USING btree ("store_id","huddle_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_morning_whispers_store_user_date" ON "morning_whispers" USING btree ("store_id","user_id","whisper_date");--> statement-breakpoint
CREATE INDEX "idx_morning_whispers_user_date" ON "morning_whispers" USING btree ("user_id","whisper_date");--> statement-breakpoint
CREATE INDEX "idx_offsite_rules_location" ON "offsite_allowance_rules" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_offsite_sessions_user" ON "offsite_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_offsite_sessions_status" ON "offsite_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_offsite_sessions_time_entry" ON "offsite_sessions" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX "idx_overtime_alerts_employee" ON "overtime_alerts" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_overtime_alerts_status" ON "overtime_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_overtime_alerts_week" ON "overtime_alerts" USING btree ("week_start_date");--> statement-breakpoint
CREATE INDEX "idx_schedules_user_start" ON "schedules" USING btree ("user_id","start_time");--> statement-breakpoint
CREATE INDEX "idx_schedules_start" ON "schedules" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "idx_score_history_user_date" ON "score_history" USING btree ("user_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_score_history_user_date" ON "score_history" USING btree ("user_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_score_notices_user" ON "score_notices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_score_notices_user_category" ON "score_notices" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "IDX_shopify_orders_shop_date" ON "shopify_orders" USING btree ("shop_domain","order_created_at");--> statement-breakpoint
CREATE INDEX "IDX_shopify_orders_order_id" ON "shopify_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_sop_embeddings_store_type" ON "sop_embeddings" USING btree ("store_id","source_type");--> statement-breakpoint
CREATE INDEX "idx_sop_embeddings_source" ON "sop_embeddings" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sop_embeddings_source_type" ON "sop_embeddings" USING btree ("source_id","source_type");--> statement-breakpoint
CREATE INDEX "idx_sop_executions_store_emp_status" ON "sop_executions" USING btree ("store_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "idx_sop_executions_template_started" ON "sop_executions" USING btree ("template_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_sop_executions_store_started" ON "sop_executions" USING btree ("store_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_sop_insights_store_status" ON "sop_insights" USING btree ("store_id","status","severity");--> statement-breakpoint
CREATE INDEX "idx_sop_insights_template" ON "sop_insights" USING btree ("sop_template_id");--> statement-breakpoint
CREATE INDEX "idx_sop_revisions_store_status" ON "sop_revision_proposals" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_sop_revisions_template_status" ON "sop_revision_proposals" USING btree ("sop_template_id","status");--> statement-breakpoint
CREATE INDEX "idx_sop_step_completions_exec_step" ON "sop_step_completions" USING btree ("execution_id","step_id");--> statement-breakpoint
CREATE INDEX "idx_sop_steps_template_order" ON "sop_steps" USING btree ("template_id","step_order");--> statement-breakpoint
CREATE INDEX "idx_sop_templates_store_active_cat" ON "sop_templates" USING btree ("store_id","is_active","category");--> statement-breakpoint
CREATE INDEX "idx_sop_templates_store_created" ON "sop_templates" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_assigned_to" ON "tasks" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "idx_tasks_due_date" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "idx_thread_messages_thread_created" ON "thread_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_thread_messages_sender" ON "thread_messages" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_thread_participants_user" ON "thread_participants" USING btree ("user_id","thread_id");--> statement-breakpoint
CREATE INDEX "idx_thread_participants_thread" ON "thread_participants" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_time_entries_user_clockin" ON "time_entries" USING btree ("user_id","clock_in_time");--> statement-breakpoint
CREATE INDEX "idx_time_entries_clockin" ON "time_entries" USING btree ("clock_in_time");--> statement-breakpoint
CREATE INDEX "idx_time_entry_edits_entry" ON "time_entry_edits" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX "idx_time_entry_edits_edited_at" ON "time_entry_edits" USING btree ("edited_at");--> statement-breakpoint
CREATE INDEX "idx_user_achievements_user" ON "user_achievements" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_achievements_user_key" ON "user_achievements" USING btree ("user_id","achievement_key");--> statement-breakpoint
CREATE INDEX "idx_user_availability_user_date" ON "user_availability" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "idx_user_availability_period" ON "user_availability" USING btree ("payroll_period_id");--> statement-breakpoint
CREATE INDEX "idx_users_role_id" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_users_is_active" ON "users" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_video_comments_video_created" ON "video_comments" USING btree ("video_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_video_likes_video" ON "video_likes" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "idx_video_likes_employee" ON "video_likes" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_weekly_reviews_user_store" ON "weekly_reviews" USING btree ("user_id","store_id");
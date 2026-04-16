CREATE TABLE "location_permissions" (
        "user_id" varchar PRIMARY KEY NOT NULL,
        "status" varchar(20) NOT NULL,
        "reported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location_permissions" ADD CONSTRAINT "location_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

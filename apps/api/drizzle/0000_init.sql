CREATE TABLE "finds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"walk_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"note" text,
	"photo_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finds_note_or_photo" CHECK ("finds"."note" is not null or "finds"."photo_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "link_finds" (
	"link_id" uuid NOT NULL,
	"find_id" uuid NOT NULL,
	CONSTRAINT "link_finds_link_id_find_id_pk" PRIMARY KEY("link_id","find_id")
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"walk_id" uuid NOT NULL,
	"token" text NOT NULL,
	"start_point_id" uuid,
	"end_point_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_walkId_unique" UNIQUE("walk_id"),
	CONSTRAINT "links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "route_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"walk_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "walks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"walked_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finds" ADD CONSTRAINT "finds_walk_id_walks_id_fk" FOREIGN KEY ("walk_id") REFERENCES "public"."walks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_finds" ADD CONSTRAINT "link_finds_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_finds" ADD CONSTRAINT "link_finds_find_id_finds_id_fk" FOREIGN KEY ("find_id") REFERENCES "public"."finds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_walk_id_walks_id_fk" FOREIGN KEY ("walk_id") REFERENCES "public"."walks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_start_point_id_route_points_id_fk" FOREIGN KEY ("start_point_id") REFERENCES "public"."route_points"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_end_point_id_route_points_id_fk" FOREIGN KEY ("end_point_id") REFERENCES "public"."route_points"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_points" ADD CONSTRAINT "route_points_walk_id_walks_id_fk" FOREIGN KEY ("walk_id") REFERENCES "public"."walks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walks" ADD CONSTRAINT "walks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finds_walk_id_idx" ON "finds" USING btree ("walk_id");--> statement-breakpoint
CREATE INDEX "route_points_walk_id_seq_idx" ON "route_points" USING btree ("walk_id","seq");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "walks_user_id_idx" ON "walks" USING btree ("user_id");
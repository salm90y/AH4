CREATE TABLE `watch_rooms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(120) NOT NULL,
	`hostParticipantId` varchar(96) NOT NULL,
	`passwordSalt` varchar(64),
	`passwordHash` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `watch_rooms_id` PRIMARY KEY(`id`),
	CONSTRAINT `watch_rooms_code_unique` UNIQUE(`code`)
);

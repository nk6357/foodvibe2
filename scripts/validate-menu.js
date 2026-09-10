import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const restaurantDir = path.join(publicDir, "restaurant");
const menuPath = path.join(restaurantDir, "menu.json");

const SECRET_PATTERNS = [
  /smtp_password/i,
  /api[_-]?key/i,
  /secret/i,
  /private[_-]?key/i,
];

const htmlPattern = /<[^>]+>/;
const safeString = (maxLength) =>
  z
    .string()
    .max(maxLength)
    .refine((value) => !htmlPattern.test(value), { message: "HTML is not allowed" });

const rgbColorSchema = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);

const httpsUrlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith("https://"), {
    message: "Only HTTPS URLs are allowed",
  });

const menuSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    restaurant: z.object({
      name: safeString(120),
      shortDescription: safeString(200).optional(),
      description: safeString(1000).optional(),
      currency: z.string().min(3).max(3).default("RUB"),
      locale: z.string().min(2).default("ru-RU"),
      timeZone: z.string().min(1),
      phone: safeString(30).optional(),
      email: z.string().email().optional(),
      address: safeString(200).optional(),
      workingHours: safeString(120).optional(),
      mapUrl: z.union([z.literal(""), httpsUrlSchema]).optional(),
      socialLinks: z
        .array(
          z.object({
            type: z.enum([
              "telegram",
              "whatsapp",
              "instagram",
              "vk",
              "website",
              "other",
            ]),
            label: safeString(60),
            url: httpsUrlSchema,
          }),
        )
        .default([]),
    }),
    theme: z.object({
      accent: rgbColorSchema,
      background: rgbColorSchema,
      cardStyle: z.enum(["rounded", "sharp"]).default("rounded"),
      imageStyle: z.enum(["cover", "contain"]).default("cover"),
      density: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
    }),
    features: z.object({
      search: z.boolean().default(true),
      categoryNavigation: z.boolean().default(true),
      dishModal: z.boolean().default(true),
      contacts: z.boolean().default(true),
      downloadableMenu: z.boolean().default(false),
      showDescriptions: z.boolean().default(true),
      showWeights: z.boolean().default(true),
      showLabels: z.boolean().default(true),
      showAllergens: z.boolean().default(true),
      showSpiceLevel: z.boolean().default(true),
      showUnavailableItems: z.boolean().default(false),
    }),
    legal: z
      .object({
        enabled: z.boolean().default(false),
        version: safeString(20).optional(),
        organizationName: safeString(200).optional(),
        privacyEmail: z.string().email().optional(),
        offerDocument: z.string().optional(),
        privacyDocument: z.string().optional(),
      })
      .default({ enabled: false }),
    seo: z
      .object({
        index: z.boolean().default(true),
        title: z.string().nullable().default(null),
        description: z.string().nullable().default(null),
      })
      .default({ index: true, title: null, description: null }),
    downloads: z
      .array(
        z.object({
          id: z.string().min(1).max(60),
          title: safeString(120),
          description: safeString(200).optional(),
          file: z.string().min(1),
        }),
      )
      .default([]),
    categories: z
      .array(
        z.object({
          id: z
            .string()
            .min(1)
            .max(60)
            .regex(/^[a-z0-9-]+$/, "Category id must be lowercase alphanumeric"),
          name: safeString(80),
          description: safeString(200).optional(),
          items: z
            .array(
              z.object({
                id: z.number().int().positive(),
                name: safeString(120),
                description: safeString(500).optional(),
                price: z.number().min(0),
                oldPrice: z.number().min(0).nullable().default(null),
                weight: safeString(40).optional(),
                labels: z.array(safeString(40)).default([]),
                allergens: z.array(safeString(60)).default([]),
                spiceLevel: z.number().int().min(0).max(3).default(0),
                available: z.boolean().default(true),
                hasImage: z.boolean().default(true),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  })
  .superRefine((data, ctx) => {
    const dishIds = new Set();
    const categoryIds = new Set();

    for (const category of data.categories) {
      if (categoryIds.has(category.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate category id: ${category.id}`,
        });
      }
      categoryIds.add(category.id);

      for (const item of category.items) {
        if (dishIds.has(item.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate dish id: ${item.id}`,
          });
        }
        dishIds.add(item.id);

        if (item.oldPrice !== null && item.oldPrice <= item.price) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `oldPrice must be greater than price for dish ${item.id}`,
          });
        }
      }
    }

    if (data.features.downloadableMenu && data.downloads.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "downloads must not be empty when downloadableMenu is enabled",
      });
    }

    if (data.legal.enabled) {
      if (!data.legal.version) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "legal.version is required when legal.enabled is true",
        });
      }
      if (!data.legal.organizationName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "legal.organizationName is required when legal.enabled is true",
        });
      }
    }
  });

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`✓ ${message}`);
}

function isValidTimeZone(timeZone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

function resolvePublicPath(relativePath) {
  return path.join(publicDir, relativePath.replace(/^\/+/, ""));
}

function scanForSecrets(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanForSecrets(fullPath);
      continue;
    }

    const lowerName = entry.name.toLowerCase();
    if (
      lowerName.includes(".env") ||
      lowerName.includes("credentials") ||
      lowerName.includes("secret")
    ) {
      fail(`Suspicious file in public folder: ${path.relative(root, fullPath)}`);
    }

    if (!/\.(json|svg|webp|pdf|txt|png|jpg|jpeg)$/i.test(entry.name)) {
      continue;
    }

    const content = fs.readFileSync(fullPath, "utf8");
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        fail(`Potential secret pattern found in ${path.relative(root, fullPath)}`);
      }
    }
  }
}

function main() {
  if (!fs.existsSync(menuPath)) {
    fail("public/restaurant/menu.json not found");
  }

  let menu;
  try {
    menu = menuSchema.parse(JSON.parse(fs.readFileSync(menuPath, "utf8")));
  } catch (error) {
    fail(`menu.json validation failed: ${error.message}`);
  }

  if (!isValidTimeZone(menu.restaurant.timeZone)) {
    fail(`Invalid IANA timeZone: ${menu.restaurant.timeZone}`);
  }

  const requiredAssets = [
    "restaurant/assets/logo.svg",
    "restaurant/assets/cover.webp",
    "restaurant/assets/placeholder.webp",
  ];

  for (const asset of requiredAssets) {
    const fullPath = resolvePublicPath(asset);
    if (!fs.existsSync(fullPath)) {
      fail(`Missing required asset: public/${asset}`);
    }
  }

  const dishesDir = path.join(restaurantDir, "assets/dishes");
  if (!fs.existsSync(dishesDir)) {
    fail("Missing public/restaurant/assets/dishes directory");
  }

  const dishFiles = new Set(
    fs
      .readdirSync(dishesDir)
      .filter((file) => file.endsWith(".webp"))
      .map((file) => file.replace(/\.webp$/, "")),
  );

  const expectedDishImages = new Set();

  for (const category of menu.categories) {
    for (const item of category.items) {
      if (item.hasImage) {
        expectedDishImages.add(String(item.id));
        const imagePath = path.join(dishesDir, `${item.id}.webp`);
        if (!fs.existsSync(imagePath)) {
          fail(
            `Missing dish image for id ${item.id}: public/restaurant/assets/dishes/${item.id}.webp`,
          );
        }
      }
    }
  }

  for (const fileId of dishFiles) {
    if (!expectedDishImages.has(fileId)) {
      fail(
        `Unexpected dish image without menu item: public/restaurant/assets/dishes/${fileId}.webp`,
      );
    }
  }

  if (menu.features.downloadableMenu) {
    for (const download of menu.downloads) {
      const filePath = resolvePublicPath(download.file);
      if (!fs.existsSync(filePath)) {
        fail(`Missing download file: public/${download.file}`);
      }
    }
  }

  if (menu.legal.enabled) {
    for (const doc of [menu.legal.offerDocument, menu.legal.privacyDocument]) {
      if (
        doc &&
        !/^https:\/\//i.test(doc) &&
        !fs.existsSync(resolvePublicPath(doc))
      ) {
        fail(`Missing legal document: public/${doc}`);
      }
    }
  }

  const maxFileSize = 5 * 1024 * 1024;
  const checkSize = (filePath) => {
    const stats = fs.statSync(filePath);
    if (stats.size > maxFileSize) {
      fail(`File too large (>5MB): ${path.relative(root, filePath)}`);
    }
  };

  for (const asset of requiredAssets) {
    checkSize(resolvePublicPath(asset));
  }

  for (const fileId of expectedDishImages) {
    checkSize(path.join(dishesDir, `${fileId}.webp`));
  }

  scanForSecrets(restaurantDir);

  info(`menu.json schemaVersion ${menu.schemaVersion} is valid`);
  info(`${menu.categories.length} categories validated`);
  info(`${expectedDishImages.size} dish images validated`);
  info("No unexpected dish images found");
  info("Required assets present");
  console.log("\nValidation passed.");
}

main();

/**
 * The deployed commit, short. It keys every source and extraction cache
 * and is stamped on each report, so a deploy never serves results the
 * earlier build wrote (Oct 29: the first Mazzarella run after a fix came
 * back as the old report, word for word).
 */
export const BUILD_ID = (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "dev").slice(0, 7);

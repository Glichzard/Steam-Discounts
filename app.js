const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const dotenv = require("dotenv");
const path = require("path");
const jwt = require("jsonwebtoken");
const puppeteer = require("puppeteer");
const mysql = require("mysql");
const fs = require("fs");

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

const API_KEY = process.env.GOOGLE_API_KEY;
const ENGINE = process.env.GOOGLE_ENGINE;

const app = express();
const port = process.env.EXPRESS_PORT;

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.EXPRESS_SECRET));
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 30 * 24 * 60 * 60 * 1000,
        },
    })
);
app.use(passport.initialize());
app.use(
    passport.session({
        cookie: {
            maxAge: 30 * 24 * 60 * 60 * 1000,
        },
    })
);
app.use(express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_REDIRECT_URI,
            scope: ["email", "profile"],
        },
        (accessToken, refreshToken, profile, done) => {
            const email = profile.emails[0].value;
            const name = profile.displayName;
            const photo = profile.photos[0].value;

            done(null, { email, name, photo });
        }
    )
);

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

const connection = mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: process.env.MYSQL_DATABASE,
});

connection.connect((error) => {
    if (error) {
        console.error("Error de conexión a MySQL:", error);
        throw error;
    }
    console.log("Conexión a MySQL establecida correctamente");
});

const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return res.redirect("/");
    }
    return next();
};

function authenticateToken(req, res, next) {
    const token = req.cookies.token;

    if (token == undefined || !req.isAuthenticated())
        return res.status(401).redirect("/login");

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            if (err.name === "TokenExpiredError") {
                return res.status(401).json({ error: "Token expired" });
            } else {
                console.log(err);
                return res.sendStatus(403);
            }
        }

        req.user = user;
        next();
    });
}

const generateToken = (user) => {
    const payload = user;

    const options = {
        expiresIn: "1h",
    };

    return jwt.sign(payload, JWT_SECRET, options);
};

app.get(
    "/",
    (req, res, next) => {
        if (req.isAuthenticated()) {
            res.locals.user = req.session.user;
        }
        return next();
    },
    (req, res) => {
        res.render("index", { user: res.locals.user });
    }
);

app.get("/login", isAuthenticated, (req, res) => {
    res.redirect("/auth/google");
});

app.get("/auth", (req, res) => {
    if (req.isAuthenticated()) {
        const token = req.cookies.token;
        return res.json({ authenticated: true, token });
    }

    return res.json({ authenticated: false });
});

app.get(
    "/auth/google",
    isAuthenticated,
    passport.authenticate("google", { scope: ["email", "profile"] })
);

app.get(
    "/auth/google/callback",
    isAuthenticated,
    passport.authenticate("google", { failureRedirect: "/" }),
    (req, res) => {
        const { email, name, photo } = req.user;

        const token = generateToken({ email, name, photo });

        res.cookie("token", token, { maxAge: 3600000, httpOnly: false });

        req.session.user = { email, name, photo, token };
        res.redirect("/");
    }
);

app.get("/logout", (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error(err);
            return next(err);
        }

        req.session.destroy();
        res.clearCookie("token");

        res.redirect("/");
        3;
    });
});

app.get("/mylist", authenticateToken, (req, res) => {
    res.render("list");
});

app.get("/list", authenticateToken, (req, res) => {
    const user = req.user.email;

    const query = "SELECT * FROM list WHERE email = ?";

    connection.query(query, user, async (err, dbResults) => {
        if (err) {
            console.error("Error en la consulta a la base de datos:", err);
            return res
                .status(500)
                .json({ error: "Error en la consulta a la base de datos" });
        }

        const results = [];
        const groups = {};

        dbResults.map((row) => {
            if (groups[row.gameId] == undefined) {
                groups[row.gameId] = [];
            }
            groups[row.gameId].push(row.purchaseIndex);
        });

        for (const game of Object.keys(groups)) {
            results.push(
                await openWebPage(
                    `https://store.steampowered.com/app/${game}`,
                    groups[game].sort((a, b) => a - b)
                )
            );
        }

        console.log(results);

        res.json(results);
    });
});

app.put("/list/:gameId/:index", authenticateToken, (req, res) => {
    const gameId = req.params.gameId;
    const purchaseIndex = req.params.index;

    const data = {
        email: req.user.email,
        gameId,
        purchaseIndex,
    };

    const querySelect =
        "SELECT * FROM list WHERE email = ? AND gameId = ? AND purchaseIndex = ?";
    const valueSelect = [data.email, data.gameId, data.purchaseIndex];

    connection.query(querySelect, valueSelect, (err, results) => {
        if (err) {
            return res.status(500).json({ ok: false });
        }

        if (results.length > 0) {
            return;
        }

        const insertQuery = "INSERT INTO list SET ?";

        connection.query(insertQuery, data, (err, results) => {
            if (!err) {
                return res.json({ ok: true });
            }
            res.status(500).json({ ok: false });
        });
    });
});

app.delete("/list/:gameId/:index", authenticateToken, (req, res) => {
    const gameId = req.params.gameId;
    const purchaseIndex = req.params.index;

    const data = {
        email: req.user.email,
        gameId,
        purchaseIndex,
    };
    
    console.log(data)

    const deleteQuery =
        "DELETE FROM list WHERE email = ? AND gameId = ? AND purchaseIndex = ?";
    const valuesQuery = [data.email, data.gameId, data.purchaseIndex];

    console.log(connection.format(deleteQuery, valuesQuery))

    connection.query(deleteQuery, valuesQuery, (err, results) => {
        if (err) {
            return res.status(500).json({ ok: false });
        }

        return res  .json({ ok: true });
    });
});

app.get("/search/:game", async (req, res) => {
    try {
        const game = req.params.game;

        if (game == "") {
            res.json({ message: "Empty field" }).status(400);
        }

        const result = await fetch(
            `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${ENGINE}&q=${game}`
        ).then((response) => response.json());

        // console.log(result)

        // if (result.error.code == 429) {
        //     return res
        //         .status(500)
        //         .json({
        //             error: "Cuota de Google alcanzada, 100 peticiones en un dia",
        //         });
        // }

        console.log(result.items);

        if (result.items == undefined) {
            console.log("se entro en este if");
            return res
                .status(500)
                .json({ error: "No se encontraron resultados" });
        }

        const results = [];

        await Promise.all(
            result.items.map(async (element) => {
                console.log(element.link);
                if (element.link.split("/")[3] === "app") {
                    results.push(await openWebPage(element.link));
                }
            })
        );

        if (results.length == 0) {
            return res
                .status(500)
                .json({ error: "No se encontraron resultados" });
        }

        res.json(results);
    } catch (error) {
        console.log("error", error);
        res.status(500).json({ error: "Error en el servidor" });
    }
});

const openWebPage = async (link, purchaseIndex = -1) => {
    console.log(link);
    console.log(purchaseIndex);
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.goto("https://store.steampowered.com");

    await page.setCookie({
        name: "birthtime",
        value: "817783201",
        domain: "store.steampowered.com",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: false,
        sameSite: "None",
    });
    await page.setCookie({
        name: "wants_mature_content",
        value: "1",
        domain: "store.steampowered.com",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: false,
        sameSite: "None",
    });

    await page.goto(link);

    console.log("Trabajando con: " + (await page.url()));

    const info = await page.evaluate(() => {
        const title = document.querySelector(
            "div#appHubAppName.apphub_AppName"
        ).innerText;
        const image = document.querySelector("img.game_header_image_full").src;
        return {
            title,
            image,
        };
    });

    const prices = await page.evaluate((purchaseIndex) => {
        const pricesList = [];
        const areaPurchaseCount = document
            .querySelector(".game_description_column")
            .querySelectorAll(
                ".game_area_purchase_game:not(.game_area_purchase_game_dropdown_subscription)"
            ).length;

        for (let i = 0; i < areaPurchaseCount; i++) {
            if (purchaseIndex != -1 && !purchaseIndex.includes(i)) {
                continue;
            }

            const purchase = document
                .querySelector(".game_description_column")
                .querySelectorAll(".game_area_purchase_game")
                [i].querySelector(".game_purchase_action_bg");

            if (purchase.childElementCount == 1) {
                pricesList.push({
                    title: document
                        .querySelector(".game_description_column")
                        .querySelectorAll(".game_area_purchase_game")
                        [i].querySelector("h1").innerHTML,
                    original: "Free",
                    finally: 0,
                    discount: 0,
                });
            }

            if (purchase.childElementCount > 1) {
                const getPrice = document
                    .querySelector(".game_description_column")
                    .querySelectorAll(".game_area_purchase_game")
                    [i].querySelector(".game_purchase_action_bg").children[0];
                if (getPrice.childElementCount == 0) {
                    pricesList.push({
                        title: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector("h1").innerHTML,
                        original: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector(".game_purchase_action_bg")
                            .children[0].innerText,
                        finally: 0,
                        discount: 0,
                    });
                }

                if (getPrice.childElementCount > 0) {
                    pricesList.push({
                        title: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector("h1").innerHTML,
                        original: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector(".game_purchase_action_bg")
                            .children[0].querySelector(
                                ".discount_original_price"
                            ).innerText,
                        finally: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector(".game_purchase_action_bg")
                            .children[0].querySelector(".discount_final_price")
                            .innerText,
                        discount: document
                            .querySelector(".game_description_column")
                            .querySelectorAll(".game_area_purchase_game")
                            [i].querySelector(".game_purchase_action_bg")
                            .children[0].querySelector(".discount_pct")
                            .innerText,
                    });
                }
            }
        }

        return pricesList;
    }, purchaseIndex);

    await browser.close();

    return {
        link,
        info,
        prices,
    };
};

app.listen(port, () => {
    console.log(`Servidor Express escuchando en el puerto ${port}`);
});
